import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { emptyIR, type Modality, type PromptIR } from '../src/ir/types.ts';
import type { ModelProfile } from '../src/registry/types.ts';

/**
 * Every rule here is a heuristic over prose, so each gets two tests: one that it
 * fires, and one that it stays quiet on writing it must not touch. A rule that
 * cries wolf is worse than a missing one — it teaches people to ignore the panel.
 */

const video: ModelProfile = {
  id: 'test-video',
  label: 'Test Video',
  family: 'video',
  syntax: 'shot-description',
  renderer: 'shot-description',
  limits: { durationS: 15 },
  rules: [
    'emotions-are-physical',
    'only-visible-and-audible',
    'exit-frame-means-gone',
    'skin-realism-block',
  ],
};

const image: ModelProfile = {
  id: 'test-image',
  label: 'Test Image',
  family: 'image',
  syntax: 'natural',
  renderer: 'natural',
  rules: ['emotions-are-physical', 'skin-realism-block'],
};

function ir(patch: Partial<PromptIR>, modality: Modality = 'video'): PromptIR {
  return { ...emptyIR(modality), ...patch };
}

const ruleIds = (r: ReturnType<typeof compile>): string[] => r.findings.map((f) => f.ruleId);

describe('clip-duration-limit', () => {
  it('blocks a video longer than the model generates, naming both numbers', () => {
    const result = compile(ir({ shot: { durationS: 22 } }), video);

    expect(result.blocked).toBe(true);
    const f = result.findings.find((x) => x.ruleId === 'clip-duration-limit');
    expect(f?.message).toContain('22s');
    expect(f?.message).toContain('15s');
  });

  it('allows a video at the limit', () => {
    expect(compile(ir({ shot: { durationS: 15 } }), video).blocked).toBe(false);
  });

  it('says nothing when the profile states no cap', () => {
    const uncapped: ModelProfile = { ...video, limits: {} };
    expect(ruleIds(compile(ir({ shot: { durationS: 99 } }), uncapped))).not.toContain(
      'clip-duration-limit',
    );
  });
});

describe('quote-in-image-text', () => {
  it('strips quotes the author already added, so they do not come back doubled', () => {
    const result = compile(
      ir({ textInImage: [{ exact: '"FOCUS"', placement: 'top-centre' }] }, 'image'),
      image,
    );

    expect(result.ir.textInImage?.[0]?.exact).toBe('FOCUS');
    expect(result.render.text).toContain('"FOCUS" top-centre');
    expect(result.render.text).not.toContain('""');
  });

  it('warns when text has no position, because then the model picks one', () => {
    const result = compile(ir({ textInImage: [{ exact: 'SALE' }] }, 'image'), image);
    const f = result.findings.find((x) => x.ruleId === 'quote-in-image-text');
    expect(f?.level).toBe('warn');
    expect(f?.fix).toContain('zone');
  });

  it('warns once past three elements', () => {
    const many = ['A', 'B', 'C', 'D'].map((exact) => ({ exact, placement: 'somewhere' }));
    const result = compile(ir({ textInImage: many }, 'image'), image);
    expect(result.findings.some((f) => f.message.includes('degrade into shapes'))).toBe(true);
  });

  it('says nothing about three placed elements', () => {
    const ok = ['A', 'B', 'C'].map((exact) => ({ exact, placement: 'somewhere' }));
    expect(ruleIds(compile(ir({ textInImage: ok }, 'image'), image))).not.toContain(
      'quote-in-image-text',
    );
  });
});

describe('emotions-are-physical', () => {
  it('catches a label standing in for a performance', () => {
    const result = compile(ir({ subject: { action: 'he looks angry at the door' } }), video);
    const f = result.findings.find((x) => x.ruleId === 'emotions-are-physical');
    expect(f?.level).toBe('warn');
    expect(f?.message).toContain('looks angry');
  });

  it('leaves physical description alone', () => {
    const result = compile(
      ir({ subject: { action: 'his jaw tightens and his nostrils flare' } }),
      video,
    );
    expect(ruleIds(result)).not.toContain('emotions-are-physical');
  });

  it('does not fire on the word alone, only the giveaway construction', () => {
    const result = compile(
      ir({ subject: { action: 'he crosses the angry red line painted on the floor' } }),
      video,
    );
    expect(ruleIds(result)).not.toContain('emotions-are-physical');
  });
});

describe('only-visible-and-audible', () => {
  it('flags what no camera can record', () => {
    const result = compile(
      ir({ environment: { description: 'the air smells of cedar and old varnish' } }),
      video,
    );
    const f = result.findings.find((x) => x.ruleId === 'only-visible-and-audible');
    expect(f?.level).toBe('warn');
    expect(f?.fix).toContain('cedar shavings');
  });

  it('leaves the visible evidence version alone', () => {
    const result = compile(
      ir({ environment: { description: 'cedar shavings on the workbench, dust drifting in the light' } }),
      video,
    );
    expect(ruleIds(result)).not.toContain('only-visible-and-audible');
  });
});

describe('exit-frame-means-gone', () => {
  it('blocks an exit and a return inside one take', () => {
    const result = compile(
      ir({ subject: { action: 'she walks out of frame, and a moment later returns with a lantern' } }),
      video,
    );

    expect(result.blocked).toBe(true);
    expect(ruleIds(result)).toContain('exit-frame-means-gone');
  });

  it('allows an exit that stays an exit', () => {
    const result = compile(ir({ subject: { action: 'she walks out of frame' } }), video);
    expect(result.blocked).toBe(false);
  });

  it('reads beats as part of the same continuous take', () => {
    const result = compile(
      ir({
        subject: { action: 'she stands at the counter' },
        beats: [
          { t: '00:00', action: 'she leaves the frame' },
          { t: '00:04', action: 'she comes back holding a cup' },
        ],
      }),
      video,
    );
    expect(ruleIds(result)).toContain('exit-frame-means-gone');
  });

  it('ignores a return that precedes the exit', () => {
    const result = compile(
      ir({ subject: { action: 'she returns to the counter, then walks out of frame' } }),
      video,
    );
    expect(ruleIds(result)).not.toContain('exit-frame-means-gone');
  });
});

describe('skin-realism-block', () => {
  const person = { subject: { entities: [{ id: 'p', type: 'person' as const, name: 'a woman' }] } };

  it('adds the block for an image with a person in it', () => {
    const result = compile(ir(person, 'image'), image);
    expect(result.ir.texture?.skinBlock).toBe(true);
    expect(result.render.text).toContain('realistic pores');
  });

  it('adds it in video only when the face is close', () => {
    const close = compile(ir({ ...person, shot: { size: 'close-up' } }), video);
    const wide = compile(ir({ ...person, shot: { size: 'wide' } }), video);

    expect(close.ir.texture?.skinBlock).toBe(true);
    expect(wide.ir.texture?.skinBlock).toBeUndefined();
  });

  it('respects a deliberate false', () => {
    const result = compile(ir({ ...person, texture: { skinBlock: false } }, 'image'), image);
    expect(result.ir.texture?.skinBlock).toBe(false);
    expect(ruleIds(result)).not.toContain('skin-realism-block');
  });

  it('says nothing when there is no person', () => {
    const result = compile(
      ir({ subject: { entities: [{ id: 'b', type: 'product', name: 'a bottle' }] } }, 'image'),
      image,
    );
    expect(ruleIds(result)).not.toContain('skin-realism-block');
  });
});
