import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import {
  fieldsForSegment,
  getPath,
  leavesUnder,
  provenanceFor,
  setPath,
} from '../src/ir/paths.ts';
import type { PromptIR } from '../src/ir/types.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';

const registry = await loadBuiltinRegistry();
const ir = JSON.parse(
  await readFile(fileURLToPath(new URL('./golden/cowboy-saloon.ir.json', import.meta.url)), 'utf8'),
) as PromptIR;

describe('reading a path', () => {
  it('walks objects and array indices', () => {
    expect(getPath(ir, 'environment.timeOfDay')).toBe('mid-afternoon');
    expect(getPath(ir, 'subject.entities[1].name')).toBe('Saloon bartender');
    expect(getPath(ir, 'lighting.sources[0]')).toContain('golden afternoon sunlight');
  });

  it('returns undefined rather than throwing on a path that is not there', () => {
    expect(getPath(ir, 'audio.bpm')).toBeUndefined();
    expect(getPath(ir, 'subject.entities[9].name')).toBeUndefined();
    expect(getPath(ir, 'lighting.key.deeper.still')).toBeUndefined();
  });
});

describe('writing a path', () => {
  it('sets a value without touching the document it was given', () => {
    const next = setPath(ir, 'environment.timeOfDay', 'dusk');

    expect(getPath(next, 'environment.timeOfDay')).toBe('dusk');
    expect(getPath(ir, 'environment.timeOfDay')).toBe('mid-afternoon');
  });

  it('creates the objects along the way', () => {
    const next = setPath(ir, 'audio.genre', 'saloon piano');
    expect(getPath(next, 'audio.genre')).toBe('saloon piano');
  });

  it('removes the field when the value is emptied', () => {
    // An empty string in the IR renders as an empty clause, which is worse
    // than the field being absent.
    const cleared = setPath(ir, 'environment.timeOfDay', '   ');
    expect('timeOfDay' in (cleared.environment ?? {})).toBe(false);

    const compiled = compile(cleared, getProfile(registry, 'kling-3-omni'));
    expect(compiled.render.text).toContain('Scene: Inside a dusty Wild West frontier saloon\n');
  });

  it('edits reach the compiled prompt', () => {
    const next = setPath(ir, 'subject.action', 'the cowboy sets down his glass');
    const compiled = compile(next, getProfile(registry, 'kling-3-omni'));

    expect(compiled.render.text).toContain('Movement: the cowboy sets down his glass');
  });
});

describe('finding the fields behind a chip', () => {
  it('opens a nested section into its own editable leaves', () => {
    const leaves = leavesUnder(ir, 'lighting');
    const paths = leaves.map((l) => l.path);

    expect(paths).toContain('lighting.key');
    expect(paths).toContain('lighting.contrast');
    expect(leaves.find((l) => l.path === 'lighting.sources')?.kind).toBe('string[]');
  });

  it('walks into each entity rather than stopping at the array', () => {
    const paths = leavesUnder(ir, 'subject').map((l) => l.path);

    expect(paths).toContain('subject.entities[0].name');
    expect(paths).toContain('subject.entities[1].description');
    expect(paths).toContain('subject.action');
  });

  it('resolves the wildcard paths a renderer wrote', () => {
    const fields = fieldsForSegment(ir, ['subject.headline', 'subject.entities[].name']);
    const paths = fields.map((f) => f.path);

    expect(paths).toContain('subject.headline');
    expect(paths).toContain('subject.entities[0].name');
    expect(paths).toContain('subject.entities[1].name');
  });

  it('lists each field once even when two sources overlap', () => {
    const fields = fieldsForSegment(ir, ['subject', 'subject.action']);
    const actions = fields.filter((f) => f.path === 'subject.action');

    expect(actions).toHaveLength(1);
  });

  it('gives every rendered segment something to edit', () => {
    const profile = getProfile(registry, 'kling-3-omni');
    const { render } = compile(ir, profile);

    for (const segment of render.segments) {
      expect(
        fieldsForSegment(ir, segment.from).length,
        `segment "${segment.label}" has no editable field behind it`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('the source map', () => {
  it('names the reference a field came from', () => {
    const withProvenance: PromptIR = {
      ...ir,
      provenance: [{ ref: 'saloon.png', fields: ['lighting', 'palette'] }],
    };

    expect(provenanceFor(withProvenance, 'lighting.key')).toBe('saloon.png');
    expect(provenanceFor(withProvenance, 'subject.action')).toBeUndefined();
  });
});
