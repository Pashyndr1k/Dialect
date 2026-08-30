import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { composeBundle, sceneLines, type Bundle } from '../src/compose/index.ts';
import type { ExtractedScene } from '../src/extract/schema.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import {
  asBundleItem,
  parseSource,
  sortSources,
  sourceId,
  sourceToYaml,
  SourceError,
  type SavedSource,
} from '../src/sources/index.ts';

const registry = await loadBuiltinRegistry();

const COWBOY: ExtractedScene = {
  headline: 'an aged cowboy at a saloon bar',
  entities: [
    {
      name: 'the cowboy',
      type: 'person',
      description: 'a weathered man in his late sixties, silver stubble, a dust-covered duster',
    },
  ],
  action: 'leans on the bar',
  location: 'a frontier saloon',
  locationDescription: 'a long scratched counter',
  timeOfDay: 'mid-afternoon',
  era: '1880s',
  shotSize: 'medium',
  angle: 'eye level',
  aspectRatio: '4:5',
  lightingKey: 'warm oil lanterns',
  lightingSources: [],
  contrast: 'high',
  colorTemp: 'warm',
  opticsEffect: 'the room falls into soft blur',
  palette: ['#2B1D12'],
  grade: 'warm, muted',
  grain: 'fine-uniform',
  medium: 'film still',
  genre: 'western',
  atmosphere: 'dust in the lantern light',
  textInImage: [],
};

const SAVED: SavedSource = {
  id: 'the-cowboy',
  name: 'The cowboy',
  kind: 'image',
  role: 'subject',
  lines: sceneLines(COWBOY),
  from: 'cowboy.png',
  savedAt: '2026-08-30',
};

describe('a source worth keeping', () => {
  it('survives being written and read back', () => {
    const round = parseSource(sourceToYaml(SAVED), 'the-cowboy.yaml');
    expect(round).toEqual(SAVED);
  });

  it('is a file a person can open and fix a word in', () => {
    const yaml = sourceToYaml(SAVED);

    expect(yaml.startsWith('id: the-cowboy')).toBe(true);
    expect(yaml).toContain('silver stubble');
    // The lines are a list, because sentences are what anyone would edit.
    expect(yaml).toMatch(/lines:\n\s+-/);
  });

  it('keeps a picture last, where it cannot bury the words', () => {
    const withThumb = { ...SAVED, thumb: `data:image/jpeg;base64,${'A'.repeat(400)}` };
    const yaml = sourceToYaml(withThumb);

    expect(yaml.indexOf('thumb:')).toBeGreaterThan(yaml.indexOf('lines:'));
    expect(parseSource(yaml, 'x.yaml').thumb).toBe(withThumb.thumb);
  });

  it('refuses a source that says nothing', () => {
    expect(() => parseSource('id: a\nname: A\nlines: []\n', 'a.yaml')).toThrow(SourceError);
    expect(() => parseSource('id: a\nname: A\nlines: ["  "]\n', 'a.yaml')).toThrow(/says nothing/);
  });

  it('says what is missing rather than that something is wrong', () => {
    expect(() => parseSource('id: a\n', 'a.yaml')).toThrow(/missing name, lines/);
  });

  it('keeps the lines when the role or kind is one this build does not know', () => {
    const odd = parseSource(
      'id: a\nname: A\nkind: hologram\nrole: vibe\nlines: ["Subject: something"]\n',
      'a.yaml',
    );

    expect(odd.lines).toEqual(['Subject: something']);
    expect(odd.role).toBe('auto');
    expect(odd.kind).toBe('words');
  });

  it('names itself uniquely', () => {
    expect(sourceId('The Cowboy')).toBe('the-cowboy');
    expect(sourceId('The Cowboy', ['the-cowboy'])).toBe('the-cowboy-2');
    expect(sourceId('!!!')).toBe('source');
  });

  it('lists the one just kept first', () => {
    const older = { ...SAVED, id: 'a', savedAt: '2026-01-01' };
    const newer = { ...SAVED, id: 'b', savedAt: '2026-08-30' };

    expect(sortSources([older, newer]).map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('using one', () => {
  it('goes into a bundle with its job intact and nothing to pay', async () => {
    const provider = new MockProvider([COWBOY]);
    const bundle: Bundle = {
      modality: 'image',
      items: [
        { id: 'words', kind: 'words', role: 'auto', lines: ['at night, in the rain'] },
        asBundleItem(SAVED),
      ],
    };

    const { ir } = await composeBundle(new Gateway(provider), bundle);

    // One call: the reading it carries was bought long ago.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.images).toBeUndefined();
    expect(provider.calls[0]?.instruction).toContain('silver stubble');
    expect(provider.calls[0]?.instruction).toContain('job: subject');
    expect(compile(ir, getProfile(registry, 'nano-banana-2')).blocked).toBe(false);
  });

  it('can be the whole of a bundle, with nothing typed', async () => {
    const provider = new MockProvider([COWBOY]);
    const bundle: Bundle = { modality: 'image', items: [asBundleItem(SAVED)] };

    await composeBundle(new Gateway(provider), bundle);
    expect(provider.calls[0]?.instruction).toContain('the cowboy');
  });

  it('is the same character in two different prompts', async () => {
    const gateway = new Gateway(new MockProvider([COWBOY, COWBOY]), { budgetUsd: 10 });
    const item = asBundleItem(SAVED);

    const one = await composeBundle(gateway, {
      modality: 'image',
      items: [{ id: 'words', kind: 'words', role: 'auto', lines: ['on a station platform'] }, item],
    });
    const two = await composeBundle(gateway, {
      modality: 'image',
      items: [{ id: 'words', kind: 'words', role: 'auto', lines: ['in a rowing boat'] }, item],
    });

    // Different questions, so different answers are paid for — but the
    // description of who he is went into both, unchanged and unbought.
    expect(one.key).not.toBe(two.key);
    for (const ir of [one.ir, two.ir]) {
      expect(ir.provenance?.map((p) => p.ref)).toContain('the-cowboy');
    }
  });

  it('carries the job into provenance, so the source map says what it was for', async () => {
    const { ir } = await composeBundle(
      new Gateway(new MockProvider([COWBOY]), { budgetUsd: 10 }),
      {
        modality: 'image',
        items: [
          asBundleItem({ ...SAVED, id: 'a-look', role: 'style' }),
          { id: 'words', kind: 'words', role: 'auto', lines: ['a lighthouse'] },
        ],
      },
    );

    const fields = new Map(ir.provenance?.map((p) => [p.ref, p.fields]));
    expect(fields.get('a-look')).toContain('lighting');
    expect(fields.get('a-look')).not.toContain('subject.headline');
  });
});
