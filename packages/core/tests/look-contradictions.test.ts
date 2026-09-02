import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { emptyIR, type PromptIR } from '../src/ir/types.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';

const registry = await loadBuiltinRegistry();
const profile = getProfile(registry, 'nano-banana-2');

const still = (patch: Partial<PromptIR>): PromptIR => ({ ...emptyIR('image'), ...patch });

/** A person, which is what both of these rules key off. */
const WARRIOR = {
  subject: {
    headline: 'a pot-bellied classical warrior toasting',
    entities: [
      {
        id: 'warrior',
        name: 'the warrior',
        type: 'person' as const,
        description: 'a very heavy cartoon warrior rendered in one flat blue-violet matte material',
      },
    ],
  },
};

/**
 * Both of these came off one live run: eight variations of one document along
 * the look axis, every one of them carrying a contradiction the tests had never
 * seen because every fixture until now was a photograph.
 */

describe('the skin block belongs to photographs', () => {
  it('is still added to a photograph with a person in it', () => {
    const result = compile(still({ ...WARRIOR, style: { medium: 'photograph' } }), profile);
    expect(result.render.text).toContain('realistic pores');
  });

  it('is not asked of a charcoal drawing', () => {
    // The live case. A figure the same document calls flat matte clay was being
    // told to have pores and fine hairs.
    const result = compile(
      still({
        ...WARRIOR,
        style: { medium: 'compressed charcoal and white chalk on toned laid paper' },
      }),
      profile,
    );
    expect(result.render.text).not.toContain('realistic pores');
  });

  it.each([
    ['oil on gessoed panel, worked impasto', 'style.medium'],
    ['painted cel, hand-inked outline', 'style.medium'],
    ['uncooled microbolometer thermal video', 'style.medium'],
    ['two-colour risograph on newsprint', 'style.medium'],
  ])('is not asked of %s', (medium) => {
    const result = compile(still({ ...WARRIOR, style: { medium } }), profile);
    expect(result.render.text).not.toContain('realistic pores');
  });

  it('reads the claim wherever the composer put it, not only the medium', () => {
    // "Minimalist monochrome character study / animated character design" came
    // back in the genre, and the medium said nothing useful at all.
    const result = compile(
      still({ ...WARRIOR, style: { genre: 'animated character design' } }),
      profile,
    );
    expect(result.render.text).not.toContain('realistic pores');
  });

  it('leaves an explicit choice alone either way', () => {
    const forced = compile(
      still({ ...WARRIOR, style: { medium: 'charcoal' }, texture: { skinBlock: true } }),
      profile,
    );
    expect(forced.render.text).toContain('realistic pores');
  });
});

describe('a picture cannot be both colourless and coloured', () => {
  const findingOf = (ir: PromptIR): ReturnType<typeof compile>['findings'][number] | undefined =>
    compile(ir, profile).findings.find((f) => f.ruleId === 'mono-vs-colour');

  it('catches the pair the live run produced', () => {
    const finding = findingOf(
      still({
        ...WARRIOR,
        style: { genre: 'minimalist monochrome character study' },
        palette: { grade: 'ironbow false colour — white-hot belly, amber torso' },
      }),
    );

    expect(finding?.level).toBe('warn');
    expect(finding?.message).toContain('style.genre');
    expect(finding?.message).toContain('palette.grade');
  });

  it('catches it against named hues, however the grade is worded', () => {
    const finding = findingOf(
      still({
        ...WARRIOR,
        style: { genre: 'black-and-white study' },
        palette: { dominant: ['#2B1D12', '#A8690A'] },
      }),
    );
    expect(finding?.message).toContain('colour(s) are named');
  });

  it('says nothing about a document that is only monochrome', () => {
    expect(
      findingOf(
        still({
          ...WARRIOR,
          style: { genre: 'monochrome character study' },
          palette: { grade: 'neutral graphite scale, mid-grey base tone' },
        }),
      ),
    ).toBeUndefined();
  });

  it('says nothing about a document that is only in colour', () => {
    expect(
      findingOf(
        still({
          ...WARRIOR,
          style: { genre: 'western' },
          palette: { grade: 'warm amber, deep shadows' },
        }),
      ),
    ).toBeUndefined();
  });

  it('does not mistake a warm monochrome for a contradiction', () => {
    // "Warm" and "high contrast" are degrees, not colour claims: a black and
    // white print can be warm, and warning about it would be noise.
    expect(
      findingOf(
        still({
          ...WARRIOR,
          style: { genre: 'greyscale portrait' },
          palette: { grade: 'warm, high contrast, deep blacks' },
        }),
      ),
    ).toBeUndefined();
  });

  it('never blocks, because which half is wrong is the author to decide', () => {
    const result = compile(
      still({
        ...WARRIOR,
        style: { genre: 'monochrome study' },
        palette: { grade: 'saturated crimson and emerald' },
      }),
      profile,
    );
    expect(result.blocked).toBe(false);
  });
});
