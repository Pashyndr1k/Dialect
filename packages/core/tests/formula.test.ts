import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { compile } from '../src/compile.ts';
import type { PromptIR } from '../src/ir/types.ts';
import { parseProfile } from '../src/registry/load.ts';
import type { ModelProfile } from '../src/registry/types.ts';
import { FieldSpecError, partsFor } from '../src/renderers/resolve.ts';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

const ir = JSON.parse(await readFile(here('./golden/cowboy-saloon.ir.json'), 'utf8')) as PromptIR;
const cardText = await readFile(here('../src/registry/models/kling-3-omni.yaml'), 'utf8');
const kling = parseProfile(cardText, 'kling-3-omni.yaml');

/** Edit the card the way a user would, then compile against the result. */
function withCard(edit: (card: Record<string, unknown>) => void): ModelProfile {
  const card = parseYaml(cardText) as Record<string, unknown>;
  edit(card);
  return card as unknown as ModelProfile;
}

/**
 * Phase 4 was defined by one thing: Kling's formula existing as an editable
 * card rather than a function. These tests are what that claim means — the
 * output has to follow an edit to the YAML, with no code touched.
 */
describe('the formula is data', () => {
  it('is nine fields in the order the model expects', () => {
    expect(kling.fields?.map((f) => f.name)).toEqual([
      'Subject',
      'SubjectDescription',
      'Movement',
      'Scene',
      'SceneDescription',
      'Camera',
      'Lighting',
      'Atmosphere',
      'Negative',
    ]);
  });

  it('follows a reordering of the card', () => {
    const swapped = withCard((card) => {
      const fields = card['fields'] as unknown[];
      [fields[3], fields[5]] = [fields[5], fields[3]]; // Scene <-> Camera
    });

    const labels = compile(ir, swapped).render.segments.map((s) => s.label);
    expect(labels.indexOf('Camera')).toBeLessThan(labels.indexOf('Scene'));
  });

  it('follows a change to what feeds a field', () => {
    const terser = withCard((card) => {
      const fields = card['fields'] as Array<Record<string, unknown>>;
      const camera = fields.find((f) => f['name'] === 'Camera')!;
      camera['from'] = ['shot.framing', '@cameraMove'];
    });

    const camera = compile(ir, terser).render.segments.find((s) => s.label === 'Camera');
    expect(camera?.text).toBe('Medium two-shot, slow push-in');
    expect(camera?.text).not.toContain("bartender's right shoulder");
  });

  it('follows a change to the separator', () => {
    const piped = withCard((card) => {
      const fields = card['fields'] as Array<Record<string, unknown>>;
      fields.find((f) => f['name'] === 'Scene')!['join'] = ' | ';
    });

    const scene = compile(ir, piped).render.segments.find((s) => s.label === 'Scene');
    expect(scene?.text).toBe('Inside a dusty Wild West frontier saloon | mid-afternoon');
  });

  it('lets a new field be added without touching the renderer', () => {
    const extended = withCard((card) => {
      (card['fields'] as unknown[]).splice(8, 0, {
        name: 'Palette',
        from: ['palette.dominant[]', 'palette.grade'],
      });
    });

    // The fixture carries no palette, so the new field also has to appear on an
    // IR that does — proving the card reaches fields the renderer never knew.
    const withPalette: PromptIR = {
      ...ir,
      palette: { dominant: ['#A8690A', '#2B1D12'], grade: 'warm and low' },
    };

    const palette = compile(withPalette, extended).render.segments.find(
      (s) => s.label === 'Palette',
    );
    expect(palette?.text).toBe('#A8690A, #2B1D12, warm and low');
  });
});

describe('a field that resolves to nothing', () => {
  it('takes its deliberate minimal value rather than disappearing', () => {
    const bare: PromptIR = { ...ir, mood: {}, environment: { location: 'a room' } };
    const segments = compile(bare, kling).render.segments;

    expect(segments.find((s) => s.label === 'Atmosphere')?.text).toBe('neutral');
    expect(segments.find((s) => s.label === 'SceneDescription')?.text).toBe('minimal context');
    // Nothing is skipped: all eight body fields are still present.
    expect(segments).toHaveLength(8);
  });
});

describe('first mode', () => {
  it('falls back to the next source only when the one before it is empty', () => {
    const spec = kling.fields!.find((f) => f.name === 'Subject')!;

    expect(partsFor(ir, spec, kling)).toEqual([ir.subject?.headline]);

    const { headline: _dropped, ...rest } = ir.subject ?? {};
    const headless: PromptIR = { ...ir, subject: rest };
    expect(partsFor(headless, spec, kling)).toEqual([
      'Aged cowboy musician',
      'Saloon bartender',
    ]);
  });
});

describe('a card that asks for something the build does not have', () => {
  it('fails loudly and names what it does know', () => {
    const bogus = withCard((card) => {
      const fields = card['fields'] as Array<Record<string, unknown>>;
      fields.find((f) => f['name'] === 'Camera')!['from'] = ['@filmStock'];
    });

    expect(() => compile(ir, bogus)).toThrow(FieldSpecError);
    expect(() => compile(ir, bogus)).toThrow(/@cameraMove, @lens/);
  });
});
