import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadLayers, newestCard, type Layer } from '../src/registry/layers.ts';
import { RENDERERS } from '../src/renderers/index.ts';
import { emptyIR } from '../src/ir/types.ts';

const RENDERER_NAMES = Object.keys(RENDERERS);

/** The label is a parameter rather than an appended line: two `label:` keys in
    one mapping is not an override, it is a duplicate, and YAML keeps the first. */
const card = (id: string, label = id) => `
id: ${id}
label: ${label}
family: image
syntax: natural
renderer: natural
source:
  name: test
  dated: "2026-01-01"
`;

const layer = (origin: string, cards: Array<[string, string]>): Layer => ({
  origin,
  cards: cards.map(([source, text]) => ({ source, text })),
});

const opts = { renderers: RENDERER_NAMES };

describe('layers', () => {
  it('loads what shipped', () => {
    const { registry, rejected } = loadLayers([layer('built in', [['a.yaml', card('a')]])], opts);

    expect(rejected).toEqual([]);
    expect(getProfile(registry, 'a').label).toBe('a');
  });

  it('lets a later layer replace a card by id', () => {
    const { registry, origin } = loadLayers(
      [
        layer('built in', [['a.yaml', card('a')]]),
        layer('channel', [['a.yaml', card('a', 'newer')]]),
      ],
      opts,
    );

    expect(registry.profiles.size).toBe(1);
    expect(getProfile(registry, 'a').label).toBe('newer');
    expect(origin.get('a')).toBe('channel');
  });

  it('adds cards a later layer brings that were not there before', () => {
    const { registry, origin } = loadLayers(
      [layer('built in', [['a.yaml', card('a')]]), layer('yours', [['b.yaml', card('b')]])],
      opts,
    );

    expect([...registry.profiles.keys()].sort()).toEqual(['a', 'b']);
    expect(origin.get('a')).toBe('built in');
    expect(origin.get('b')).toBe('yours');
  });
});

describe('a card that will not load', () => {
  it('does not take the rest of its layer with it', () => {
    const { registry, rejected } = loadLayers(
      [
        layer('channel', [
          ['good.yaml', card('good')],
          ['broken.yaml', 'this: [is not: valid yaml'],
          ['also-good.yaml', card('also-good')],
        ]),
      ],
      opts,
    );

    expect([...registry.profiles.keys()].sort()).toEqual(['also-good', 'good']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.source).toBe('broken.yaml');
    expect(rejected[0]?.origin).toBe('channel');
  });

  it('leaves the card underneath it standing', () => {
    const { registry, origin, rejected } = loadLayers(
      [
        layer('built in', [['a.yaml', card('a')]]),
        layer('channel', [['a.yaml', 'id: a\nlabel: broken\n']]),
      ],
      opts,
    );

    // The replacement is missing required fields, so the original still works.
    expect(getProfile(registry, 'a').label).toBe('a');
    expect(origin.get('a')).toBe('built in');
    expect(rejected[0]?.reason).toContain('missing');
  });

  it('says what is missing rather than that something is wrong', () => {
    const { rejected } = loadLayers([layer('yours', [['x.yaml', 'id: x\n']])], opts);
    expect(rejected[0]?.reason).toContain('label, family, syntax, renderer');
  });

  it('refuses a card this build cannot render', () => {
    const future = card('future').replace('renderer: natural', 'renderer: holograph');
    const { registry, rejected } = loadLayers([layer('channel', [['f.yaml', future]])], opts);

    expect(registry.profiles.size).toBe(0);
    expect(rejected[0]?.reason).toContain('"holograph" renderer, which this build does not have');
    // And says what it does have, so the version gap is obvious.
    expect(rejected[0]?.reason).toContain('natural');
  });

  it('refuses a field list with no fields, rather than failing at render time', () => {
    const empty = card('empty').replace('renderer: natural', 'renderer: field-list');
    const { rejected } = loadLayers([layer('channel', [['e.yaml', empty]])], opts);

    expect(rejected[0]?.reason).toContain('names no fields');
  });

  it('keeps the first of two cards claiming one id, and says so', () => {
    const { registry, rejected } = loadLayers(
      [
        layer('channel', [
          ['first.yaml', card('a', 'first')],
          ['second.yaml', card('a', 'second')],
        ]),
      ],
      opts,
    );

    expect(getProfile(registry, 'a').label).toBe('first');
    expect(rejected[0]?.source).toBe('second.yaml');
    expect(rejected[0]?.reason).toContain('claim the id "a"');
  });

  it('takes any renderer when the caller does not say what it has', () => {
    const future = card('future').replace('renderer: natural', 'renderer: holograph');
    const { registry } = loadLayers([layer('channel', [['f.yaml', future]])]);

    expect(registry.profiles.size).toBe(1);
  });
});

describe('the real card set, through layers', () => {
  it('loads every card this build ships, and rejects none of them', async () => {
    const { loadBuiltinRegistry } = await import('../src/registry/load-node.ts');
    const shipped = await loadBuiltinRegistry();

    const cards = await Promise.all(
      [...shipped.profiles.values()].map(async (p) => {
        const { readFile } = await import('node:fs/promises');
        const { BUILTIN_MODELS_DIR } = await import('../src/registry/load-node.ts');
        return {
          source: `${p.id}.yaml`,
          text: await readFile(`${BUILTIN_MODELS_DIR}${p.id}.yaml`, 'utf8'),
        };
      }),
    );

    const { registry, rejected } = loadLayers([{ origin: 'built in', cards }], opts);

    expect(rejected).toEqual([]);
    expect(registry.profiles.size).toBe(shipped.profiles.size);
    // And every one of them still compiles something.
    for (const profile of registry.profiles.values()) {
      const ir = { ...emptyIR(profile.family === 'pipeline' ? 'image' : profile.family) };
      expect(() => compile(ir, profile)).not.toThrow();
    }
  });

  it('says how old the newest card is', async () => {
    const { loadBuiltinRegistry } = await import('../src/registry/load-node.ts');
    expect(newestCard(await loadBuiltinRegistry())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
