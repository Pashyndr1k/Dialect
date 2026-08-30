import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { emptyIR, type PromptIR } from '../src/ir/types.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { loadBuiltinDecks } from '../src/vary/load-node.ts';
import {
  applyVariant,
  AXIS_FIELDS,
  decksFor,
  drawFrom,
  MAX_VARIANTS,
  NothingToVaryError,
  parseDeck,
  vary,
  variedProvenance,
  varyInstruction,
  VARY_AXES,
  type Deck,
} from '../src/vary/index.ts';

const registry = await loadBuiltinRegistry();
const decks = await loadBuiltinDecks();

const BASE: PromptIR = {
  ...emptyIR('image'),
  title: 'the smith',
  subject: {
    headline: 'a dwarven smith at an anvil',
    entities: [
      { id: 'e1', type: 'person', name: 'the smith', description: 'broad, soot in the creases' },
      { id: 'e2', type: 'person', name: 'an apprentice', description: 'thin, watching' },
    ],
    action: 'raises the hammer',
  },
  environment: { location: 'a forge' },
  lighting: { key: 'the forge fire' },
  palette: { grade: 'warm, sooty' },
  style: { medium: 'hand-painted texture', genre: 'dark fantasy' },
  shot: { size: 'medium', angle: 'eye level' },
  mood: { atmosphere: 'sparks hanging in the dark' },
};

const subjects = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    label: `Smith ${i + 1}`,
    headline: `an elven bowyer, number ${i + 1}`,
    description: `wiry, a burn scar, number ${i + 1}`,
    action: 'draws a stave across the bench',
  }));

const gatewayWith = (answers: unknown[]) => new Gateway(new MockProvider(answers), { budgetUsd: 10 });

describe('asking for several at once', () => {
  it('is one call, not one per variant', async () => {
    const provider = new MockProvider([{ variants: subjects(12) }]);
    const { variants } = await vary(new Gateway(provider), BASE, { axis: 'subject', count: 12 });

    expect(provider.calls).toHaveLength(1);
    expect(variants).toHaveLength(12);
  });

  it('says they must differ from each other, which is the whole task', async () => {
    const provider = new MockProvider([{ variants: subjects(3) }]);
    await vary(new Gateway(provider), BASE, { axis: 'subject', count: 3 });

    const system = provider.calls[0]?.system ?? '';
    expect(system).toContain('must differ from each other');
    expect(system).toContain('not a version');
  });

  it('names the axis and holds everything off it', async () => {
    const looks = Array.from({ length: 3 }, (_, i) => ({
      label: `Look ${i + 1}`,
      medium: 'cyanotype',
      grade: 'blue',
      lightingKey: 'a copy stand',
      grain: 'none',
    }));
    const provider = new MockProvider([{ variants: looks }]);
    await vary(new Gateway(provider), BASE, { axis: 'look', count: 3 });

    expect(provider.calls[0]?.system).toContain('is not yours to touch');
    expect(provider.calls[0]?.instruction).toContain('the medium, the grade');
  });

  it('tells it what the document already says, so it does not offer that back', () => {
    const asked = varyInstruction(BASE, { axis: 'look', count: 4 });

    expect(asked).toContain('none of your versions should be this one');
    expect(asked).toContain('Medium: hand-painted texture');
    expect(asked).toContain('Key light: the forge fire');
  });

  it('carries a brief and a drawn card into the question', () => {
    const nudge = { id: 'c1', name: 'The Incongruous Backdrop', text: 'It must be somewhere wrong.' };
    const asked = varyInstruction(BASE, { axis: 'subject', count: 6, brief: 'townsfolk', nudge });

    expect(asked).toContain('Stay within this: townsfolk');
    expect(asked).toContain('The Incongruous Backdrop');
    expect(asked).toContain('structural, not a detail');
  });

  it('does not hand back an answer bought without the card', async () => {
    const gateway = gatewayWith([{ variants: subjects(4) }, { variants: subjects(4) }]);
    const nudge = { id: 'c1', name: 'A', text: 'B' };

    const plain = await vary(gateway, BASE, { axis: 'subject', count: 4 });
    const nudged = await vary(gateway, BASE, { axis: 'subject', count: 4, nudge });
    expect(plain.key).not.toBe(nudged.key);
  });

  it('refuses a document with nothing in it', async () => {
    await expect(
      vary(gatewayWith([{ variants: subjects(3) }]), emptyIR('image'), {
        axis: 'subject',
        count: 3,
      }),
    ).rejects.toThrow(NothingToVaryError);
  });

  it('will not ask for one, or for a hundred', async () => {
    const one = new MockProvider([{ variants: subjects(2) }]);
    await vary(new Gateway(one), BASE, { axis: 'subject', count: 1 });
    expect(one.calls[0]?.instruction).toContain('Give 2 versions');

    const many = new MockProvider([{ variants: subjects(2) }]);
    await vary(new Gateway(many), BASE, { axis: 'subject', count: 500 });
    expect(many.calls[0]?.instruction).toContain(`Give ${MAX_VARIANTS} versions`);
  });
});

describe('putting one back', () => {
  it('writes the axis and nothing else', () => {
    const next = applyVariant(BASE, 'look', {
      label: 'Blueprint',
      medium: 'cyanotype print',
      grade: 'blue and white, no midtones',
      lightingKey: 'flat copy-stand light',
      grain: 'heavy',
    } as never);

    expect(next.style?.medium).toBe('cyanotype print');
    expect(next.texture?.grain).toBe('heavy');
    // Untouched, because the axis does not name them.
    expect(next.subject?.headline).toBe(BASE.subject?.headline);
    expect(next.environment?.location).toBe('a forge');
    expect(next.shot?.size).toBe('medium');
  });

  it('replaces who the subject is rather than adding another person', () => {
    const next = applyVariant(BASE, 'subject', {
      label: 'The bowyer',
      headline: 'an elven bowyer at a bench',
      description: 'wiry, a burn scar across one cheek',
      action: 'draws a stave across the bench',
    } as never);

    expect(next.subject?.entities).toHaveLength(2);
    expect(next.subject?.entities?.[0]?.description).toContain('burn scar');
    // The apprentice was never being varied and is still there.
    expect(next.subject?.entities?.[1]?.name).toBe('an apprentice');
  });

  it('drops a value the IR takes from a fixed set when it is not one of them', () => {
    const next = applyVariant(BASE, 'framing', {
      label: 'Odd',
      shotSize: 'from a drone',
      angle: 'high above the forge',
    } as never);

    // The angle is free text and lands; the size is not and does not.
    expect(next.shot?.angle).toBe('high above the forge');
    expect(next.shot?.size).toBe('medium');
  });

  it('names each one, so a list of twenty is readable', () => {
    const next = applyVariant(BASE, 'mood', {
      label: 'Cold and still',
      atmosphere: 'the fire is out, frost on the anvil',
      emotion: 'nothing has happened here for a while',
    } as never);

    expect(next.title).toBe('Cold and still');
    expect(next.mood?.atmosphere).toContain('frost');
  });

  it('makes something that still compiles', () => {
    for (const axis of VARY_AXES) {
      const next = applyVariant(BASE, axis, {
        label: 'x',
        headline: 'a wandering tinker',
        description: 'stooped, a coat of pockets',
        action: 'sets down a pack',
        medium: 'ink wash',
        grade: 'grey',
        lightingKey: 'an open door',
        grain: 'none',
        atmosphere: 'dust',
        emotion: 'tired',
        shotSize: 'wide',
        angle: 'low',
        cameraMove: 'push-in',
        cameraSpeed: 'slow',
      } as never);

      expect(compile(next, getProfile(registry, 'nano-banana-2')).blocked, axis).toBe(false);
    }
  });

  it('records which fields the axis was responsible for', () => {
    expect(variedProvenance('look', 'Blueprint')[0]?.fields).toEqual(AXIS_FIELDS['look']);
    expect(variedProvenance('look', 'Blueprint')[0]?.ref).toBe('varied: Blueprint');
  });
});

describe('the decks', () => {
  it('ship with the app, and all of them load', () => {
    expect(decks.map((d) => d.id).sort()).toEqual([
      'auteur-personas',
      'micro-tones',
      'motion-presets',
      'oblique-constraints',
    ]);
    expect(decks.reduce((n, d) => n + d.entries.length, 0)).toBe(115);
  });

  it('gives every entry something to say', () => {
    for (const deck of decks) {
      for (const entry of deck.entries) {
        expect(entry.text.trim().length, `${deck.id}/${entry.id}`).toBeGreaterThan(20);
        expect(entry.name.trim(), `${deck.id}/${entry.id}`).not.toBe('');
      }
    }
  });

  it('offers the ones that belong to an axis, plus the ones that fit anywhere', () => {
    expect(decksFor(decks, 'mood').map((d) => d.id).sort()).toEqual([
      'micro-tones',
      'oblique-constraints',
    ]);
    expect(decksFor(decks, 'framing').map((d) => d.id)).toEqual(['oblique-constraints']);
  });

  it('draws one, and the same one twice when told how to choose', () => {
    const deck = decks.find((d) => d.id === 'micro-tones')!;

    expect(drawFrom(deck, () => 0)?.id).toBe(deck.entries[0]?.id);
    expect(drawFrom(deck, () => 0.999999)?.id).toBe(deck.entries.at(-1)?.id);
    // Nothing to draw from is not a crash.
    expect(drawFrom({ ...deck, entries: [] })).toBeUndefined();
  });

  it('refuses a deck with nothing usable in it', () => {
    const bad = 'id: a\nname: A\naxis: mood\nentries:\n  - id: x\n    name: X\n    text: "  "\n';
    expect(() => parseDeck(bad, 'a.yaml')).toThrow(/no usable entries/);
    expect(() => parseDeck('id: a\n', 'a.yaml')).toThrow(/missing name, axis, entries/);
  });

  it('keeps where it came from, because these age like everything else', () => {
    for (const deck of decks as Deck[]) {
      expect(deck.source?.name, deck.id).toBeTruthy();
      expect(deck.source?.dated, deck.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
