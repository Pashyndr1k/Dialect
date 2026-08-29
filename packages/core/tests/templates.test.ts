import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import { applyTemplate, chainFor, mergeFragments, variablesIn } from '../src/templates/apply.ts';
import { createLibrary } from '../src/templates/library.ts';
import { loadBuiltinLibrary } from '../src/templates/load-node.ts';
import { MissingVariablesError, TemplateError, type Snippet, type Template } from '../src/templates/types.ts';

const registry = await loadBuiltinRegistry();
const library = await loadBuiltinLibrary();

const COWBOY = {
  subject: 'a weathered cowboy in his late sixties, silver stubble under a worn hat',
  action: 'leans on the bar and speaks slowly',
  location: 'a dusty frontier saloon',
  light: 'warm oil lanterns hanging from the ceiling beams',
};

describe('merging fragments', () => {
  it('lets the later layer win, field by field', () => {
    const merged = mergeFragments(
      { shot: { size: 'wide', aspectRatio: '16:9' }, mode: 'generate' },
      { shot: { size: 'close-up' } },
    );
    expect(merged).toEqual({ shot: { size: 'close-up', aspectRatio: '16:9' }, mode: 'generate' });
  });

  it('replaces arrays rather than blending them', () => {
    const merged = mergeFragments({ lookWords: ['a', 'b', 'c'] }, { lookWords: ['d'] });
    expect(merged['lookWords']).toEqual(['d']);
  });

  it('appends when the key asks to, and does not duplicate', () => {
    const merged = mergeFragments(
      { avoid: ['blurry', 'watermark'] },
      { 'avoid+': ['watermark', 'plastic skin'] },
    );
    expect(merged['avoid']).toEqual(['blurry', 'watermark', 'plastic skin']);
  });

  it('appends onto nothing without complaint', () => {
    expect(mergeFragments({}, { 'avoid+': ['blurry'] })['avoid']).toEqual(['blurry']);
  });

  it('resolves an append nested inside a section that did not exist yet', () => {
    const merged = mergeFragments({}, { constraints: { 'avoid+': ['blurry'] } });
    expect(merged).toEqual({ constraints: { avoid: ['blurry'] } });
  });
});

describe('finding the holes', () => {
  it('reports each variable once, wherever it hides', () => {
    expect(
      variablesIn({ a: '{{one}} and {{two}}', b: [{ c: '{{one}}' }], d: 3 }),
    ).toEqual(['one', 'two']);
  });
});

describe('applying a template', () => {
  it('fills the holes and produces a compilable IR', () => {
    const { ir, used } = applyTemplate(library, 'cinematic-shot', { values: COWBOY });

    expect(ir.modality).toBe('video');
    expect(ir.subject?.headline).toBe(`${COWBOY.subject}, ${COWBOY.location}`);
    expect(used['light']).toBe(COWBOY.light);

    const result = compile(ir, getProfile(registry, 'kling-3-omni'));
    expect(result.blocked).toBe(false);
    expect(result.render.text).toContain('Movement: leans on the bar and speaks slowly');
    expect(result.render.text).toContain('Lighting: warm oil lanterns');
  });

  it('uses a default when a value is not given', () => {
    const { used } = applyTemplate(library, 'cinematic-shot', {
      values: { ...COWBOY, light: '' },
    });
    expect(used['light']).toBe('soft daylight from a window out of frame');
  });

  it('names every hole it still cannot fill', () => {
    try {
      applyTemplate(library, 'cinematic-shot', { values: { subject: 'a cowboy' } });
      expect.unreachable('should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingVariablesError);
      // Reported in the order they appear in the form, not alphabetically.
      expect((err as MissingVariablesError).missing).toEqual(['location', 'action']);
    }
  });

  it('carries its snippets in', () => {
    const { ir } = applyTemplate(library, 'cinematic-shot', { values: COWBOY });

    // film-look
    expect(ir.texture?.grain).toBe('fine-uniform');
    // clean-audio: both are unremovable after the fact, so both are off
    expect(ir.sound?.music).toBe(false);
    expect(ir.sound?.subtitles).toBe(false);
  });

  it('skips a snippet that does not apply to this modality', () => {
    const { ir } = applyTemplate(library, 'product-still', {
      values: { product: 'a matte-black cologne bottle' },
    });

    expect(ir.modality).toBe('image');
    expect(ir.sound).toBeUndefined(); // clean-audio is video-only and not asked for
    expect(ir.constraints?.avoid).toContain('plastic smooth skin');
  });
});

describe('inheritance', () => {
  it('builds the chain from the furthest ancestor down', () => {
    expect(chainFor(library, 'dialogue-shot').map((t) => t.id)).toEqual([
      'cinematic-shot',
      'dialogue-shot',
    ]);
  });

  it('lets the child override the parent and inherit the rest', () => {
    const { ir } = applyTemplate(library, 'dialogue-shot', {
      values: { ...COWBOY, line: 'You knew. The whole time, you knew.' },
    });

    expect(ir.shot?.size).toBe('medium-close'); // child
    expect(ir.shot?.aspectRatio).toBe('16:9'); // parent
    expect(ir.texture?.grain).toBe('fine-uniform'); // parent's snippet
    expect(ir.dialogue?.[0]?.line).toBe('You knew. The whole time, you knew.');
    expect(ir.dialogue?.[0]?.delivery).toEqual(['quiet, controlled, almost warm']);
  });

  it('inherits the parent variables, so the child need not restate them', () => {
    const { used } = applyTemplate(library, 'dialogue-shot', {
      values: { ...COWBOY, line: 'Careful, it is hot.' },
    });
    expect(used['light']).toBe(COWBOY.light);
  });

  it('refuses a cycle instead of hanging', () => {
    const a: Template = { id: 'a', name: 'A', modality: 'image', extends: 'b', ir: {} };
    const b: Template = { id: 'b', name: 'B', modality: 'image', extends: 'a', ir: {} };
    const looped = createLibrary([a, b], []);

    expect(() => chainFor(looped, 'a')).toThrow(TemplateError);
    expect(() => chainFor(looped, 'a')).toThrow(/extends itself/);
  });

  it('says which template is missing, and who wanted it', () => {
    const orphan: Template = { id: 'x', name: 'X', modality: 'image', extends: 'ghost', ir: {} };
    expect(() => chainFor(createLibrary([orphan], []), 'x')).toThrow(/extended by "x"/);
  });
});

describe('applying onto a document already in hand', () => {
  it('fills the gaps without overwriting what is there', () => {
    const existing = applyTemplate(library, 'cinematic-shot', { values: COWBOY }).ir;
    const edited = { ...existing, shot: { ...existing.shot, size: 'wide' as const } };

    const { ir } = applyTemplate(library, 'dialogue-shot', {
      values: { ...COWBOY, line: 'Sit down.' },
      onto: edited,
    });

    // The template would have set medium-close; the document said wide.
    expect(ir.shot?.size).toBe('wide');
    expect(ir.dialogue?.[0]?.line).toBe('Sit down.');
  });
});

describe('a snippet a template asks for but the library lacks', () => {
  it('fails by name rather than silently rendering less', () => {
    const template: Template = {
      id: 't',
      name: 'T',
      modality: 'image',
      snippets: ['not-here'],
      ir: {},
    };
    const snippet: Snippet = { id: 'here', name: 'Here', ir: {} };

    expect(() => applyTemplate(createLibrary([template], [snippet]), 't')).toThrow(/not-here/);
  });
});
