import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { assembleText } from '../src/renderers/types.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import type { PromptIR } from '../src/ir/types.ts';

const registry = await loadBuiltinRegistry();
const ir = JSON.parse(
  await readFile(fileURLToPath(new URL('./golden/cowboy-saloon.ir.json', import.meta.url)), 'utf8'),
) as PromptIR;

/**
 * Assembly is what makes the chip editor possible: switching a block off has to
 * rebuild the prompt using the dialect's own joining rules, not the editor's
 * guess at them.
 */
describe('assembling a prompt from a subset of segments', () => {
  it('round-trips to the same text when everything is enabled', () => {
    const { render } = compile(ir, getProfile(registry, 'kling-3-omni'));
    expect(assembleText(render)).toBe(render.text);
  });

  it('drops a switched-off block without leaving its label or separator behind', () => {
    const { render } = compile(ir, getProfile(registry, 'kling-3-omni'));
    const without = assembleText(render, (s) => s.label !== 'Lighting');

    expect(without).not.toContain('Lighting:');
    expect(without).not.toContain('oil lantern glow');
    expect(without).toContain('Atmosphere:');
    expect(without).not.toMatch(/\n\n\n/);
  });

  it('respects each dialect\u2019s own joining rules', () => {
    const kling = compile(ir, getProfile(registry, 'kling-3-omni')).render;
    const seedance = compile(ir, getProfile(registry, 'seedance-2.5')).render;

    expect(kling.assembly.labelled).toBe(true);
    expect(kling.assembly.separator).toBe('\n\n');
    expect(seedance.assembly.labelled).toBe(false);
    expect(seedance.assembly.separator).toBe(' ');
  });

  it('keeps the reference prefix ahead of the body, not joined into it', () => {
    const withRefs: PromptIR = {
      ...ir,
      references: [{ id: '@image1', role: 'character', src: 'cowboy.png' }],
    };
    const { render } = compile(withRefs, getProfile(registry, 'seedance-2.5'));
    expect(render.text.startsWith('@image1 ')).toBe(true);
  });
});

describe('the booster rule across dialects', () => {
  it('does not reformat a prose dialect into a field list', () => {
    const dirty: PromptIR = {
      ...ir,
      mood: { atmosphere: 'quiet, world-weary, ultra sharp, sun-baked solitude' },
    };
    const { render } = compile(dirty, getProfile(registry, 'seedance-2.5'));

    expect(render.text).not.toContain('ultra sharp');
    // Seedance prose must not acquire "Label: " prefixes on the way through.
    expect(render.text).not.toMatch(/^(Shot|Action|Environment|Look|Atmosphere):/m);
  });
});
