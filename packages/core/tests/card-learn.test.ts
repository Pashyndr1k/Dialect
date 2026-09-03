/**
 * Reading a card out of a guide.
 *
 * The call itself is one gateway request like any other and is covered by the
 * gateway's own tests. What is tested here is the part between the answer and
 * the file — because a card that names a field the IR does not have renders
 * nothing, for ever, and says nothing about why. A wrong card is not a crash;
 * it is a prompt with a hole in it that nobody notices for a week.
 */

import { describe, expect, it } from 'vitest';

import { loadBuiltinRegistry } from '../src/registry/load-node.ts';

import {
  cardFrom,
  isReadablePath,
  profileToYaml,
  parseProfile,
  vocabularyText,
  type LearnedCard,
} from '../src/index.ts';

/** A plausible answer, which each test then bends in one direction. */
function answer(over: Partial<LearnedCard> = {}): LearnedCard {
  return {
    id: 'test-model-2',
    label: 'Test Model 2',
    vendor: 'somebody',
    family: 'video',
    syntax: 'field-list',
    renderer: 'field-list',
    header: 'Test Model 2 prompt',
    routingNote: 'Pick it when the shot lives or dies on text.',
    bestFor: ['on_product_text', 'physics'],
    fields: [
      {
        name: 'Subject',
        from: ['subject.headline', 'subject.entities[].name'],
        join: '',
        mode: 'first',
        fallback: '',
        negative: false,
      },
      {
        name: 'Avoid',
        from: ['constraints.avoid[]'],
        join: ', ',
        mode: 'join',
        fallback: '',
        negative: true,
      },
    ],
    fieldOrder: [],
    separator: '\\n',
    labelled: true,
    durationS: 10,
    maxChars: 0,
    maxReferences: 4,
    maxRes: '1080p',
    negativePrompt: true,
    nativeAudio: false,
    lipSync: false,
    startEndFrame: true,
    tokenWeights: false,
    emitsGearNumbers: false,
    refSyntax: '@image{n}',
    rules: ['one-action-one-move'],
    defaults: [{ path: 'sound.music', value: 'false' }],
    sourceName: 'Test Model 2 Prompting Guide',
    sourceDated: '2026-08-01',
    confidence: 'high',
    notes: [],
    ...over,
  };
}

const OPTIONS = { url: 'https://example.test/guide', guide: '' };

describe('the card that comes out of a guide', () => {
  it('is a card the loader accepts', () => {
    const { profile } = cardFrom(answer(), OPTIONS);
    // The real check: it survives a round trip through the actual loader,
    // rather than merely satisfying the type.
    const reloaded = parseProfile(profileToYaml(profile), 'test.yaml');

    expect(reloaded.id).toBe('test-model-2');
    expect(reloaded.family).toBe('video');
    expect(reloaded.renderer).toBe('field-list');
    expect(reloaded.fields?.[0]?.name).toBe('Subject');
    expect(reloaded.fields?.[0]?.mode).toBe('first');
    expect(reloaded.fields?.[1]?.role).toBe('negative');
  });

  it('drops a field path the IR does not have, and says which', () => {
    const bent = answer({
      fields: [
        {
          name: 'Subject',
          // The second is exactly the kind of plausible invention that would
          // otherwise render as nothing at all.
          from: ['subject.headline', 'subject.appearance'],
          join: '',
          mode: 'join',
          fallback: '',
          negative: false,
        },
      ],
    });

    const { profile, dropped } = cardFrom(bent, OPTIONS);

    expect(profile.fields?.[0]?.from).toEqual(['subject.headline']);
    expect(dropped).toContain('Subject: no IR path "subject.appearance"');
  });

  it('drops a field left with nothing to read rather than keeping an empty one', () => {
    const bent = answer({
      fields: [
        {
          name: 'Nonsense',
          from: ['what.the.model.made.up'],
          join: '',
          mode: 'join',
          fallback: '',
          negative: false,
        },
      ],
    });

    const { profile, dropped } = cardFrom(bent, OPTIONS);

    expect(profile.fields).toBeUndefined();
    expect(dropped).toContain('Nonsense: nothing left for it to read');
  });

  it('keeps a field that has only a fallback, because that still prints', () => {
    const bent = answer({
      fields: [
        {
          name: 'Style',
          from: ['style.nonexistent'],
          join: '',
          mode: 'join',
          fallback: 'photographic',
          negative: false,
        },
      ],
    });

    expect(cardFrom(bent, OPTIONS).profile.fields?.[0]?.fallback).toBe('photographic');
  });

  it('drops a rule this build does not have', () => {
    const bent = answer({ rules: ['one-action-one-move', 'no-such-rule'] });
    const { profile, dropped } = cardFrom(bent, OPTIONS);

    expect(profile.rules).toEqual(['one-action-one-move']);
    expect(dropped).toContain('no engine rule "no-such-rule"');
  });

  it('falls back to a renderer that exists rather than naming one that does not', () => {
    // The schema only offers the three, but a model that answers outside its
    // enum must not produce a card that throws at render time.
    const bent = answer({ renderer: 'comma-phrases' as LearnedCard['renderer'] });
    const { profile, dropped } = cardFrom(bent, OPTIONS);

    expect(profile.renderer).toBe('natural');
    expect(dropped).toContain('no renderer "comma-phrases"; using natural');
  });

  it('writes numbers and flags as themselves, not as the strings they arrived in', () => {
    const bent = answer({
      defaults: [
        { path: 'sound.music', value: 'false' },
        { path: 'shot.durationS', value: '8' },
        { path: 'palette.grade', value: 'bleach bypass' },
        { path: 'not.a.path', value: 'x' },
      ],
    });

    const { profile, dropped } = cardFrom(bent, OPTIONS);

    expect(profile.defaults).toEqual({
      'sound.music': false,
      'shot.durationS': 8,
      'palette.grade': 'bleach bypass',
    });
    expect(dropped).toContain('default: no IR path "not.a.path"');
  });

  it('leaves out a limit the guide never stated rather than writing a zero', () => {
    // 0 means "not stated". A card claiming maxChars: 0 would refuse every
    // prompt, which is the opposite of not knowing.
    const { profile } = cardFrom(answer(), OPTIONS);

    expect(profile.limits).toEqual({ durationS: 10, references: 4, maxRes: '1080p' });
    expect(profile.limits).not.toHaveProperty('maxChars');
  });

  it('records where it came from, address and all', () => {
    const { profile } = cardFrom(answer(), OPTIONS);

    expect(profile.source?.name).toContain('Test Model 2 Prompting Guide');
    // The address especially: a card that cannot say where it came from cannot
    // be checked against the guide when the model changes.
    expect(profile.source?.name).toContain('https://example.test/guide');
    expect(profile.source?.dated).toBe('2026-08-01');
  });

  it('dates a card today when the guide is undated', () => {
    const { profile } = cardFrom(answer({ sourceDated: '' }), OPTIONS);
    expect(profile.source?.dated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('turns a written newline separator into an actual one', () => {
    // It crosses as the two characters a model can reliably write.
    const { profile } = cardFrom(answer(), OPTIONS);
    expect(profile.assembly?.separator).toBe('\n');
  });
});

describe('the vocabulary a card may read', () => {
  it('accepts the paths the built-in cards use and refuses inventions', () => {
    for (const path of [
      'subject.headline',
      'subject.entities[].description',
      'environment.timeOfDay',
      'constraints.avoid[]',
      '@cameraMove',
      '@tempo',
    ]) {
      expect(isReadablePath(path), path).toBe(true);
    }

    for (const path of ['subject.description', 'lighting', '@nothing', '']) {
      expect(isReadablePath(path), path).toBe(false);
    }
  });

  /**
   * The list is what a learned card is checked against, so a gap in it silently
   * strips a legitimate field. This caught one: every shipped card forces
   * `sound.music` under defaults and the list did not have it.
   */
  it('covers every path the cards that ship actually use', async () => {
    const registry = await loadBuiltinRegistry();
    const missing: string[] = [];

    for (const profile of registry.profiles.values()) {
      for (const field of profile.fields ?? []) {
        for (const path of field.from) {
          if (!isReadablePath(path)) missing.push(`${profile.id} ${field.name}: ${path}`);
        }
      }
      for (const path of Object.keys(profile.defaults ?? {})) {
        if (!isReadablePath(path)) missing.push(`${profile.id} defaults: ${path}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('is written out with every path explained, because a bare list teaches nothing', () => {
    const text = vocabularyText();

    expect(text).toContain('subject.entities[].description —');
    expect(text).toContain('@cameraMove —');
    // No entry may be a bare path: the description is the whole point.
    for (const line of text.split('\n').filter((l) => l.startsWith('  '))) {
      expect(line, line).toContain(' — ');
    }
  });
});
