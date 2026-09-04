/**
 * The Reference node, which now holds both halves of a reference.
 *
 * Up to three files, up to three readings of them already in Memory, and one
 * rule between: a reading picked means the files are not used. Reading a file
 * costs money and reading it twice costs money twice, so the cheap answer wins
 * when both are on the node.
 *
 * The migration matters as much as the behaviour. A graph saved before a
 * Reference could hold three files holds one, under different keys, and it has
 * to keep working — a document someone saved is not something to break.
 */

import { describe, expect, it } from 'vitest';

import { BUILTIN_NODES, filesOf, readingsOf } from '../src/index.ts';
import type { NodeContext, Value } from '../src/index.ts';

const spec = BUILTIN_NODES.get('reference')!;
const ctx = {} as NodeContext;

const run = (params: Record<string, unknown>): Promise<Record<string, Value | readonly Value[]>> =>
  spec.run({}, params, ctx);

const file = (name: string) => ({ path: `C:/refs/${name}`, name, kind: 'image' });
const reading = (id: string) => ({ id, kind: 'image', role: 'style', lines: [`${id} lines`] });

describe('a Reference node holding files', () => {
  it('emits every file as its own source, so the reader runs once per file', async () => {
    const out = await run({ files: [file('a.png'), file('b.png'), file('c.png')] });

    const sources = out.out as Value[];
    expect(sources).toHaveLength(3);
    expect(sources.map((v) => (v as { source: { name: string } }).source.name)).toEqual([
      'a.png',
      'b.png',
      'c.png',
    ]);
    expect(out.read).toBeUndefined();
  });

  it('refuses an empty node by saying what to do about it', async () => {
    await expect(run({})).rejects.toThrow(/Choose a file .* or a reading from Memory/);
    await expect(run({ files: [] })).rejects.toThrow(/Choose a file/);
  });

  it('takes the file kind from the file rather than a default', async () => {
    const out = await run({ files: [{ path: '/x/clip.mp4', name: 'clip.mp4', kind: 'video' }] });
    expect((out.out as Value[])[0]).toMatchObject({ source: { kind: 'video' } });
  });
});

describe('a Reference node holding readings from Memory', () => {
  it('emits the readings and leaves the files alone', async () => {
    const out = await run({
      files: [file('a.png'), file('b.png')],
      readings: [reading('street'), reading('portrait')],
    });

    // The whole point of the merge: a reading you already paid for is used
    // instead of reading the file again, and the file stays on the node.
    expect(out.out).toBeUndefined();
    expect(out.read as Value[]).toHaveLength(2);
    expect((out.read as Value[]).map((v) => (v as { lines: { id: string } }).lines.id)).toEqual([
      'street',
      'portrait',
    ]);
  });

  it('carries the role a reading was kept with', async () => {
    const out = await run({ readings: [reading('street')] });
    expect((out.read as Value[])[0]).toMatchObject({ lines: { role: 'style' } });
  });

  it('ignores a reading with no lines rather than emitting an empty one', async () => {
    // An empty reading renders as nothing and says nothing about why, which is
    // the failure this whole node was rearranged to avoid.
    const out = await run({
      files: [file('a.png')],
      readings: [{ id: 'broken', kind: 'image', role: 'auto', lines: [] }],
    });

    expect(out.read).toBeUndefined();
    expect(out.out as Value[]).toHaveLength(1);
  });
});

describe('a Reference saved by an older build', () => {
  it('still holds its one file, under the keys that build wrote', async () => {
    const old = { path: 'C:/refs/her.png', name: 'her.png', kind: 'image' };

    expect(filesOf(old)).toEqual([old]);
    const out = await run(old);
    expect((out.out as Value[])[0]).toMatchObject({ source: { name: 'her.png' } });
  });

  it('works out a name from the path when the older build did not store one', () => {
    expect(filesOf({ path: 'C:/refs/deep/her.png' })).toEqual([
      { path: 'C:/refs/deep/her.png', name: 'her.png', kind: 'image' },
    ]);
    expect(filesOf({ path: '/unix/style/shot.png' })[0]?.name).toBe('shot.png');
  });

  it('prefers the list once there is one, so an edited node has one shape', () => {
    // The editor writes the list and clears the old keys, but a half-migrated
    // document must not produce the file twice.
    const both = { path: 'C:/refs/old.png', name: 'old.png', kind: 'image', files: [file('new.png')] };
    expect(filesOf(both).map((f) => f.name)).toEqual(['new.png']);
  });

  it('is not confused by rubbish where a list should be', () => {
    expect(filesOf({ files: 'not a list' })).toEqual([]);
    expect(filesOf({ files: [null, 3, 'x'] })).toEqual([]);
    expect(filesOf({ files: [{ name: 'no path' }] })).toEqual([]);
    expect(readingsOf({ readings: [null, { lines: 'not a list' }] })).toEqual([]);
  });
});

describe('the node folded into it', () => {
  it('still runs, because graphs hold one', async () => {
    // Kept working and off the catalogue. A saved graph is not something to
    // break to tidy a menu.
    const kept = BUILTIN_NODES.get('kept')!;
    expect(kept.hidden).toBe(true);

    const out = await kept.run({}, { id: 'street', kind: 'image', lines: ['a wet street'] }, ctx);
    expect(out.out).toMatchObject({ lines: { id: 'street' } });
  });

  it('is the only node kept out of the catalogue', () => {
    const hidden = [...BUILTIN_NODES.values()].filter((s) => s.hidden).map((s) => s.type);
    expect(hidden).toEqual(['kept']);
  });
});
