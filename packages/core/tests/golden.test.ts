import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import { toDocument } from '../src/renderers/document.ts';
import type { PromptIR } from '../src/ir/types.ts';

const here = (name: string): string => fileURLToPath(new URL(`./golden/${name}`, import.meta.url));

/**
 * The contract this whole design rests on: a given IR must produce a given
 * prompt, byte for byte, every time. If that stops being true, batch runs stop
 * being reproducible and every template silently drifts.
 *
 * The fixture is a real prompt written by hand before Dialect existed, so the
 * test also proves the IR is expressive enough for production work.
 */
describe('golden: Kling 3.0 — aged cowboy at the saloon bar', () => {
  it('reproduces the hand-written prompt exactly', async () => {
    const ir = JSON.parse(await readFile(here('cowboy-saloon.ir.json'), 'utf8')) as PromptIR;
    const expected = await readFile(here('cowboy-saloon.kling.txt'), 'utf8');

    const registry = await loadBuiltinRegistry();
    const profile = getProfile(registry, 'kling-3-omni');
    const result = compile(ir, profile);

    expect(toDocument(result.render, profile, { title: ir.title })).toBe(expected);
  });

  it('produces nothing that would block generation', async () => {
    const ir = JSON.parse(await readFile(here('cowboy-saloon.ir.json'), 'utf8')) as PromptIR;
    const registry = await loadBuiltinRegistry();
    const result = compile(ir, getProfile(registry, 'kling-3-omni'));

    expect(result.blocked).toBe(false);
    expect(result.findings.filter((f) => f.level === 'block')).toEqual([]);
  });

  it('flags the bare lens number, which is a real weakness in the original', async () => {
    const ir = JSON.parse(await readFile(here('cowboy-saloon.ir.json'), 'utf8')) as PromptIR;
    const registry = await loadBuiltinRegistry();
    const result = compile(ir, getProfile(registry, 'kling-3-omni'));

    const finding = result.findings.find((f) => f.ruleId === 'gear-needs-effect');
    expect(finding?.level).toBe('warn');
    expect(finding?.message).toContain('50mm');
  });

  it('keeps every field of the mandatory order, in order', async () => {
    const ir = JSON.parse(await readFile(here('cowboy-saloon.ir.json'), 'utf8')) as PromptIR;
    const registry = await loadBuiltinRegistry();
    const profile = getProfile(registry, 'kling-3-omni');
    const result = compile(ir, profile);

    // The order comes from the profile's own field list, which is the formula.
    expect(result.render.segments.map((s) => s.label)).toEqual(
      profile.fields?.filter((f) => f.role !== 'negative').map((f) => f.name),
    );
    // Negative travels separately, so it is not among the body segments.
    expect(result.render.negative).toBeTruthy();
  });
});

describe('retargeting the same IR', () => {
  it('renders a completely different dialect without re-extracting anything', async () => {
    const ir = JSON.parse(await readFile(here('cowboy-saloon.ir.json'), 'utf8')) as PromptIR;
    const registry = await loadBuiltinRegistry();

    const kling = compile(ir, getProfile(registry, 'kling-3-omni'));
    const seedance = compile(ir, getProfile(registry, 'seedance-2.5'));

    expect(kling.render.text).not.toBe(seedance.render.text);
    // Seedance ignores lens numbers, so the profile drops them rather than
    // spending prompt space on a lever the model does not pull.
    expect(seedance.render.text).not.toContain('50mm');
    expect(kling.render.text).toContain('50mm lens');
    // Music and subtitles are off by default: both are unremovable after the fact.
    expect(seedance.render.text).toContain('No music.');
    expect(seedance.render.text).toContain('No subtitles.');
  });
});
