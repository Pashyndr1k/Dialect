import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { emptyIR, type PromptIR } from '../src/ir/types.ts';
import type { ModelProfile } from '../src/registry/types.ts';

const videoProfile: ModelProfile = {
  id: 'test-video',
  label: 'Test Video',
  family: 'video',
  syntax: 'shot-description',
  renderer: 'shot-description',
  supports: { emitsGearNumbers: false },
  rules: ['one-action-one-move', 'max-look-words', 'max-tracked-entities'],
};

function ir(patch: Partial<PromptIR>): PromptIR {
  return { ...emptyIR('video'), ...patch };
}

describe('no-booster-words', () => {
  it('strips boosters and says which ones it removed', () => {
    const result = compile(
      ir({ subject: { headline: 'a hyper detailed portrait, ultra sharp, warm light' } }),
      videoProfile,
    );

    expect(result.render.text).not.toMatch(/hyper detailed|ultra sharp/i);
    expect(result.render.text).toContain('warm light');

    const finding = result.findings.find((f) => f.ruleId === 'no-booster-words');
    expect(finding?.level).toBe('autofix');
    expect(finding?.message).toContain('hyper detailed');
  });

  it('leaves a clean prompt untouched', () => {
    const result = compile(ir({ subject: { headline: 'a portrait in warm light' } }), videoProfile);
    expect(result.findings.some((f) => f.ruleId === 'no-booster-words')).toBe(false);
  });

  it('does not leave dangling punctuation behind', () => {
    const result = compile(ir({ subject: { headline: 'a bottle, 8K, on slate' } }), videoProfile);
    expect(result.render.text).not.toMatch(/,\s*,|,\s*\./);
  });
});

describe('one-action-one-move', () => {
  it('blocks a video carrying two actions', () => {
    const result = compile(
      ir({ subject: { action: 'she lifts the flask and then turns to the window' } }),
      videoProfile,
    );

    expect(result.blocked).toBe(true);
    const finding = result.findings.find((f) => f.ruleId === 'one-action-one-move');
    expect(finding?.level).toBe('block');
    expect(finding?.fix).toContain('next shot');
  });

  it('allows one action', () => {
    const result = compile(ir({ subject: { action: 'she lifts the flask off the counter' } }), videoProfile);
    expect(result.blocked).toBe(false);
  });

  it('does not apply to stills', () => {
    const result = compile(
      { ...emptyIR('image'), subject: { action: 'he stands and then sits' } },
      { ...videoProfile, family: 'image' },
    );
    expect(result.blocked).toBe(false);
  });
});

describe('max-look-words', () => {
  it('warns once past three and names what to drop', () => {
    const result = compile(
      ir({ lighting: { lookWords: ['shadowplay', 'cinematic', 'editorial', 'quiet-luxury'] } }),
      videoProfile,
    );

    const finding = result.findings.find((f) => f.ruleId === 'max-look-words');
    expect(finding?.level).toBe('warn');
    expect(finding?.fix).toContain('quiet-luxury');
    expect(result.blocked).toBe(false);
  });

  it('accepts three', () => {
    const result = compile(
      ir({ lighting: { lookWords: ['shadowplay', 'cinematic', 'muted palette'] } }),
      videoProfile,
    );
    expect(result.findings.some((f) => f.ruleId === 'max-look-words')).toBe(false);
  });
});

describe('max-tracked-entities', () => {
  it('warns past three described characters', () => {
    const result = compile(
      ir({
        subject: {
          entities: ['a', 'b', 'c', 'd'].map((id) => ({
            id,
            name: `person ${id}`,
            description: `a detailed description of ${id}`,
          })),
        },
      }),
      videoProfile,
    );

    const finding = result.findings.find((f) => f.ruleId === 'max-tracked-entities');
    expect(finding?.level).toBe('warn');
    expect(finding?.message).toContain('4 characters');
  });

  it('does not count extras left generic', () => {
    const result = compile(
      ir({
        subject: {
          entities: [
            { id: 'a', name: 'lead', description: 'detailed' },
            { id: 'b', name: 'crowd' },
            { id: 'c', name: 'crowd 2' },
            { id: 'd', name: 'crowd 3' },
          ],
        },
      }),
      videoProfile,
    );
    expect(result.findings.some((f) => f.ruleId === 'max-tracked-entities')).toBe(false);
  });
});

describe('gear-needs-effect', () => {
  it('drops the lens number for a model that ignores it', () => {
    const result = compile(ir({ optics: { gearHint: '85mm' } }), videoProfile);

    expect(result.ir.optics?.gearHint).toBeUndefined();
    const finding = result.findings.find((f) => f.ruleId === 'gear-needs-effect');
    expect(finding?.level).toBe('autofix');
    expect(finding?.fix).toContain('visible effect');
  });

  it('says nothing when the number travels with its effect', () => {
    const emitting: ModelProfile = { ...videoProfile, supports: { emitsGearNumbers: true } };
    const result = compile(
      ir({ optics: { gearHint: '85mm', effect: 'background melts into soft blur' } }),
      emitting,
    );
    expect(result.findings.some((f) => f.ruleId === 'gear-needs-effect')).toBe(false);
  });
});

describe('profile defaults', () => {
  it('fills what the author left open without overriding a choice', () => {
    const profile: ModelProfile = {
      ...videoProfile,
      defaults: { 'sound.music': false, 'sound.subtitles': false },
    };

    const filled = compile(ir({}), profile);
    expect(filled.ir.sound?.music).toBe(false);

    const chosen = compile(ir({ sound: { music: true } }), profile);
    expect(chosen.ir.sound?.music).toBe(true);
    expect(chosen.ir.sound?.subtitles).toBe(false);
  });
});
