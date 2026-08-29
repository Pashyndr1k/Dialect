import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { emptyIR, type PromptIR } from '../src/ir/types.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';

const registry = await loadBuiltinRegistry();

function still(patch: Partial<PromptIR>): PromptIR {
  return { ...emptyIR('image'), ...patch };
}

describe('natural renderer — the image line', () => {
  it('states the scene in plain language rather than a tag pile', () => {
    const result = compile(
      still({
        subject: { headline: 'a matte-black cologne bottle', action: 'a single droplet lands beside it' },
        environment: { location: 'on wet slate' },
        shot: { framing: 'tight macro framing', aspectRatio: '4:5' },
        lighting: { key: 'hard raking light from the right' },
        style: { medium: 'photorealistic' },
      }),
      getProfile(registry, 'nano-banana-2'),
    );

    expect(result.render.text).toBe(
      'A matte-black cologne bottle, a single droplet lands beside it, on wet slate, ' +
        'tight macro framing, hard raking light from the right, photorealistic.',
    );
    expect(result.render.params['aspect_ratio']).toBe('4:5');
  });

  it('drops the avoid list rather than inventing a negative field the model lacks', () => {
    const result = compile(
      still({
        subject: { headline: 'a portrait' },
        constraints: { avoid: ['plastic skin', 'glamour makeup'] },
      }),
      getProfile(registry, 'nano-banana-2'),
    );

    expect(result.render.negative).toBeUndefined();
    expect(result.render.text).not.toContain('plastic skin');
  });

  it('quotes in-image text verbatim and can spell a stubborn word out', () => {
    const result = compile(
      still({
        subject: { headline: 'a bold vertical ad' },
        textInImage: [
          { exact: 'MORNINGS, UPGRADED', placement: 'across the top half' },
          { exact: 'STUDIO', placement: 'on the label', spellOut: true },
        ],
      }),
      getProfile(registry, 'gpt-image-2'),
    );

    expect(result.render.text).toContain('"MORNINGS, UPGRADED" across the top half');
    expect(result.render.text).toContain('spelled S, T, U, D, I, O');
  });

  it('adds the skin block only when asked, because models retouch faces to plastic', () => {
    const withSkin = compile(
      still({ subject: { headline: 'a close-up portrait' }, texture: { skinBlock: true } }),
      getProfile(registry, 'nano-banana-2'),
    );
    const without = compile(
      still({ subject: { headline: 'a close-up portrait' } }),
      getProfile(registry, 'nano-banana-2'),
    );

    expect(withSkin.render.text).toContain('realistic pores');
    expect(without.render.text).not.toContain('realistic pores');
  });

  it('keeps the lens number only for the model that reads it', () => {
    const ir = still({ subject: { headline: 'a portrait' }, optics: { gearHint: '85mm', effect: 'soft blur behind' } });

    expect(compile(ir, getProfile(registry, 'gpt-image-2')).render.text).toContain('85mm');
    expect(compile(ir, getProfile(registry, 'nano-banana-2')).render.text).not.toContain('85mm');
  });
});

describe('edit mode', () => {
  it('names the single change and pins everything else', () => {
    const result = compile(
      {
        ...emptyIR('image', 'edit'),
        references: [{ id: '@image1', role: 'image', src: 'shot.png' }],
        edit: {
          change: 'change the headline text to "FOCUS"',
          keep: ['the typeface', 'the size', 'the position'],
        },
      },
      getProfile(registry, 'nano-banana-2'),
    );

    expect(result.render.text).toBe(
      '@image1 Change the headline text to "FOCUS". Keep the typeface, the size, the position exactly unchanged.',
    );
  });

  it('pins everything by default when nothing is named', () => {
    const result = compile(
      { ...emptyIR('image', 'edit'), edit: { change: 'replace the background with a grey studio sweep' } },
      getProfile(registry, 'nano-banana-2'),
    );

    expect(result.render.text).toContain('Keep everything else exactly unchanged.');
  });
});

describe('routing by job', () => {
  it('sends a layout job to the layout model, not the habitual one', () => {
    const forLayout = [...registry.profiles.values()].filter((p) => p.bestFor?.includes('layout'));
    expect(forLayout.map((p) => p.id)).toEqual(['gpt-image-2']);
  });

  it('sends an edit to the model built for editing', () => {
    const forEdit = [...registry.profiles.values()].filter((p) => p.bestFor?.includes('image_edit'));
    expect(forEdit.map((p) => p.id)).toEqual(['nano-banana-2']);
  });
});
