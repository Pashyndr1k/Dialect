import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockProvider, type QueueState } from '@dialect/core';
import { loadBuiltinRegistry } from '@dialect/core/node';
import { runBatch, type BatchOptions } from '../src/batch.ts';

const registry = await loadBuiltinRegistry();
const roots: string[] = [];

/** A minimal but valid answer for every reference. */
const scene = (n: number) => ({
  headline: `reference ${n} on a table`,
  entities: [{ name: `object ${n}`, type: 'product' as const, description: `a thing, number ${n}` }],
  action: 'sits still',
  location: 'a studio table',
  locationDescription: 'seamless grey behind, the surface faintly reflective',
  timeOfDay: 'indoors, no daylight',
  era: 'contemporary',
  shotSize: 'close-up' as const,
  angle: 'slightly above',
  aspectRatio: '4:5',
  lightingKey: 'a soft box from the left',
  lightingSources: [],
  contrast: 'gentle',
  colorTemp: 'neutral',
  opticsEffect: 'the background falls away into soft blur',
  palette: ['#111111'],
  grade: 'muted',
  grain: 'fine-uniform' as const,
  medium: 'photograph',
  genre: 'product still life',
  atmosphere: 'nothing moves',
  textInImage: [],
});

async function fixture(count: number): Promise<{ folder: string; out: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dialect-batch-'));
  roots.push(root);

  const folder = join(root, 'refs');
  await mkdir(folder, { recursive: true });

  // Each file is distinct, so each gets its own cache key.
  for (let i = 0; i < count; i++) {
    await writeFile(join(folder, `ref-${String(i).padStart(3, '0')}.png`), `image bytes ${i}`);
  }
  // Something that is not an image, to be ignored.
  await writeFile(join(folder, 'notes.txt'), 'not a reference');

  return { folder, out: join(root, 'out') };
}

function options(
  folder: string,
  out: string,
  provider: MockProvider,
  extra: Partial<BatchOptions> = {},
): BatchOptions {
  return {
    folder,
    out,
    target: 'nano-banana-2',
    registry,
    budgetUsd: 100,
    concurrency: 4,
    nameAs: '{{basename}}_{{target}}.txt',
    restart: false,
    provider,
    ...extra,
  };
}

const answers = (n: number): unknown[] => Array.from({ length: n }, (_, i) => scene(i));
const readState = async (out: string): Promise<QueueState> =>
  JSON.parse(await readFile(join(out, 'batch-state.json'), 'utf8')) as QueueState;

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

describe('a folder in, prompts out', () => {
  it('writes a prompt and an IR for every reference, and ignores what is not one', async () => {
    const { folder, out } = await fixture(5);
    const provider = new MockProvider(answers(5));

    expect(await runBatch(options(folder, out, provider))).toBe(0);

    const written = (await readdir(out)).sort();
    expect(written.filter((f) => f.endsWith('.txt'))).toHaveLength(5);
    expect(written.filter((f) => f.endsWith('.ir.json'))).toHaveLength(5);
    expect(written).toContain('ref-000_nano-banana-2.txt');
    expect(written.some((f) => f.startsWith('notes'))).toBe(false);

    // Which answer reached which file depends on the order calls completed,
    // so the check is that a real prompt was written, not which one.
    const prompt = await readFile(join(out, 'ref-000_nano-banana-2.txt'), 'utf8');
    expect(prompt).toMatch(/^Nano Banana 2 prompt/);
    expect(prompt).toMatch(/reference \d+ on a table/i);
  });

  it('follows the naming pattern it is given', async () => {
    const { folder, out } = await fixture(2);
    const provider = new MockProvider(answers(2));

    await runBatch(options(folder, out, provider, { nameAs: 'prompt-{{basename}}.md' }));
    expect(await readdir(out)).toContain('prompt-ref-000.md');
  });

  it('says so plainly when there is nothing to read', async () => {
    const { folder, out } = await fixture(0);
    const provider = new MockProvider([]);

    expect(await runBatch(options(folder, out, provider))).toBe(1);
  });
});

describe('resuming', () => {
  it('spends nothing for what it already did', async () => {
    const { folder, out } = await fixture(6);

    const first = new MockProvider(answers(6));
    await runBatch(options(folder, out, first));
    expect(first.calls).toHaveLength(6);

    // A second run over the same folder: same state, same cache on disk.
    const second = new MockProvider([]);
    expect(await runBatch(options(folder, out, second))).toBe(0);
    expect(second.calls).toHaveLength(0);
  });

  it('picks up the ones a stopped run left behind', async () => {
    const { folder, out } = await fixture(8);

    // A cap that runs out partway.
    const first = new MockProvider(answers(8), { costPerCall: 1 });
    expect(await runBatch(options(folder, out, first, { budgetUsd: 3, concurrency: 1 }))).toBe(1);

    const stopped = await readState(out);
    expect(stopped.items.filter((i) => i.state === 'done')).toHaveLength(3);
    expect(stopped.stoppedBecause).toContain('cap');

    // Raise it and run the same command again.
    const second = new MockProvider(answers(8), { costPerCall: 1 });
    expect(await runBatch(options(folder, out, second, { budgetUsd: 100, concurrency: 1 }))).toBe(0);

    const finished = await readState(out);
    expect(finished.items.every((i) => i.state === 'done')).toBe(true);
    expect(finished.stoppedBecause).toBeUndefined();
    // Only the five that were left; the first three came from the cache.
    expect(second.calls).toHaveLength(5);
  });

  it('starts over when told to', async () => {
    const { folder, out } = await fixture(3);

    await runBatch(options(folder, out, new MockProvider(answers(3))));

    const again = new MockProvider(answers(3));
    await runBatch(options(folder, out, again, { restart: true }));

    // The state was discarded, but the cache still holds the answers.
    expect(again.calls).toHaveLength(0);
    const state = await readState(out);
    expect(state.items.every((i) => i.state === 'done')).toBe(true);
  });
});

describe('the budget', () => {
  it('holds across restarts rather than resetting each run', async () => {
    const { folder, out } = await fixture(10);

    const first = new MockProvider(answers(10), { costPerCall: 1 });
    await runBatch(options(folder, out, first, { budgetUsd: 4, concurrency: 1 }));
    expect((await readState(out)).spentUsd).toBeCloseTo(4);

    // The same cap again: nothing is left of it, so nothing new is read.
    const second = new MockProvider(answers(10), { costPerCall: 1 });
    expect(await runBatch(options(folder, out, second, { budgetUsd: 4, concurrency: 1 }))).toBe(1);
    expect(second.calls).toHaveLength(0);
  });
});

describe('a reference that cannot be read', () => {
  it('fails on its own without taking the batch down', async () => {
    const { folder, out } = await fixture(4);
    // One answer short of what the run needs: the mock refuses the last one.
    const provider = new MockProvider(answers(3));

    expect(await runBatch(options(folder, out, provider, { concurrency: 1 }))).toBe(1);

    const state = await readState(out);
    expect(state.items.filter((i) => i.state === 'done')).toHaveLength(3);
    expect(state.items.filter((i) => i.state === 'failed')).toHaveLength(1);
    expect((await readdir(out)).filter((f) => f.endsWith('.txt'))).toHaveLength(3);
  });
});
