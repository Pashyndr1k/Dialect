/**
 * A card set's manifest.
 *
 * Was a signing test — keypairs, a signature over the manifest bytes, a
 * cross-language check that Node and Rust agreed about Ed25519. All of it
 * guarding a folder of YAML formulas the app lets you edit by hand, so it went.
 *
 * What is left is what the manifest is actually for: naming a set, numbering
 * it, and listing exactly the cards in it and nothing else.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MANIFEST, manifestFor, writeManifest } from '../src/manifest.ts';

async function folder(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dialect-manifest-'));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body);
  }
  return dir;
}

describe('a card set describes itself', () => {
  it('lists the cards, sorted, and nothing that is not one', async () => {
    const dir = await folder({
      'b.yaml': 'id: b\n',
      'a.yaml': 'id: a\n',
      'c.yml': 'id: c\n',
      'notes.txt': 'not a card',
      'README.md': 'nor this',
    });

    const manifest = await manifestFor(dir, { channel: 'test-set', version: 3 });

    expect(manifest.files).toEqual(['a.yaml', 'b.yaml', 'c.yml']);
    expect(manifest.channel).toBe('test-set');
    expect(manifest.version).toBe(3);
  });

  it('dates a set by the day, not the moment', async () => {
    const dir = await folder({ 'a.yaml': 'id: a\n' });

    // Two sets published the same afternoon are one set, and a timestamp would
    // make two identical things look different.
    const manifest = await manifestFor(dir, { channel: 'x', version: 1 });
    expect(manifest.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const given = await manifestFor(dir, { channel: 'x', version: 1, published: '2026-01-02' });
    expect(given.published).toBe('2026-01-02');
  });

  it('writes the manifest into the folder it describes', async () => {
    const dir = await folder({ 'a.yaml': 'id: a\n' });
    const manifest = await manifestFor(dir, { channel: 'x', version: 2 });
    await writeManifest(dir, manifest);

    const read = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as typeof manifest;
    expect(read).toEqual(manifest);
    // Written to be read by a person as well as a program.
    expect(await readFile(join(dir, MANIFEST), 'utf8')).toContain('\n  "version": 2');
  });

  it('is happy with an empty folder rather than inventing a set', async () => {
    const dir = await folder({});
    const manifest = await manifestFor(dir, { channel: 'x', version: 1 });
    expect(manifest.files).toEqual([]);
  });
});
