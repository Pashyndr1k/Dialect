import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { compile, getProfile, Gateway, MockProvider, promptFileName } from '@dialect/core';
import { loadBuiltinRegistry } from '@dialect/core/node';
import type { PromptIR } from '@dialect/core';

import { runGraphFile, resolverFor } from '../src/graph.ts';

const registry = await loadBuiltinRegistry();
const roots: string[] = [];

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dialect-cli-graph-'));
  roots.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

const goldenIR = async (): Promise<PromptIR> =>
  JSON.parse(
    await readFile(
      fileURLToPath(
        new URL('../../../packages/core/tests/golden/cowboy-saloon.ir.json', import.meta.url),
      ),
      'utf8',
    ),
  ) as PromptIR;

/**
 * The window and the command line share a runner and a catalogue; only the
 * resolver differs. So the thing worth asserting here is not that graphs work —
 * that is core's business and core tests it — but that this front end wires
 * them up to the same answer.
 */
describe('a graph run from a terminal', () => {
  it('produces exactly what compiling directly produces', async () => {
    const dir = await temp();
    const out = join(dir, 'out');
    const ir = await goldenIR();

    const graph = {
      version: 1 as const,
      nodes: [
        { id: 'doc', type: 'document', params: { ir } },
        { id: 'kling', type: 'compile', params: { target: 'kling-3-omni' } },
        { id: 'nano', type: 'compile', params: { target: 'nano-banana-2' } },
        { id: 'save', type: 'save' },
      ],
      edges: [
        { from: { node: 'doc', port: 'out' }, to: { node: 'kling', port: 'ir' } },
        { from: { node: 'doc', port: 'out' }, to: { node: 'nano', port: 'ir' } },
        { from: { node: 'kling', port: 'out' }, to: { node: 'save', port: 'prompts' } },
        { from: { node: 'nano', port: 'out' }, to: { node: 'save', port: 'prompts' } },
      ],
    };

    const file = join(dir, 'graph.json');
    await writeFile(file, JSON.stringify(graph), 'utf8');

    const report = await runGraphFile({
      file,
      out,
      // Nothing here spends: a document and two renderings are all free.
      gateway: new Gateway(new MockProvider([])),
      registry,
    });

    expect(report.prompts).toBe(2);

    const written = (await readdir(out)).sort();
    expect(written).toHaveLength(2);

    const texts = await Promise.all(written.map((f) => readFile(join(out, f), 'utf8')));
    expect(texts).toContain(compile(ir, getProfile(registry, 'kling-3-omni')).render.text);
    expect(texts).toContain(compile(ir, getProfile(registry, 'nano-banana-2')).render.text);
  });

  it('says plainly that it cannot measure audio', async () => {
    // Tempo, key and loudness are counted in the desktop host. Guessing them
    // here and stating them as fact would be worse than refusing.
    const resolve = resolverFor({ ffmpeg: true, ffprobe: true });
    await expect(
      resolve({ path: '/x/song.mp3', name: 'song.mp3', kind: 'audio' }),
    ).rejects.toThrow(/cannot measure/);
  });

  it('asks for ffmpeg by name when a video needs it and it is not there', async () => {
    const resolve = resolverFor({ ffmpeg: false, ffprobe: false });
    await expect(
      resolve({ path: '/x/clip.mp4', name: 'clip.mp4', kind: 'video' }),
    ).rejects.toThrow(/ffmpeg/);
  });

  it('refuses a file that is not a graph, by name', async () => {
    const dir = await temp();
    const file = join(dir, 'not-a-graph.json');
    await writeFile(file, JSON.stringify({ hello: 'world' }), 'utf8');

    await expect(
      runGraphFile({ file, out: join(dir, 'out'), gateway: new Gateway(new MockProvider([])), registry }),
    ).rejects.toThrow(/not a graph/);
  });
});

describe('naming a prompt that becomes a file', () => {
  const promptFor = (title: string, id: string) =>
    ({ ir: { title }, profile: { id } }) as never;

  it('uses the title, which is what someone looks for', () => {
    const taken = new Set<string>();
    expect(promptFileName(promptFor('A cowboy', 'kling-3-omni'), 1, taken)).toBe('A cowboy.txt');
  });

  it('breaks a clash with the model, because that is what differs', () => {
    // One document rendered for two models is two prompts with one title.
    // Before this, the second quietly overwrote the first.
    const taken = new Set<string>();
    const a = promptFileName(promptFor('A cowboy', 'kling-3-omni'), 1, taken);
    const b = promptFileName(promptFor('A cowboy', 'nano-banana-2'), 2, taken);

    expect(a).not.toBe(b);
    expect(b).toContain('nano-banana-2');
  });

  it('falls back to a number only when even the model repeats', () => {
    const taken = new Set<string>();
    const names = [1, 2, 3].map((i) => promptFileName(promptFor('Same', 'kling-3-omni'), i, taken));
    expect(new Set(names).size).toBe(3);
  });

  it('keeps a name a filesystem will take', () => {
    const taken = new Set<string>();
    const name = promptFileName(promptFor('a/b\\c:d*e?f"g<h>i|j', 'x'), 1, taken);
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('names an untitled document rather than producing ".txt"', () => {
    const taken = new Set<string>();
    expect(promptFileName(promptFor('', 'kling-3-omni'), 4, taken)).toBe('prompt-4.txt');
  });
});
