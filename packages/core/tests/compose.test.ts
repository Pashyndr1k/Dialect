import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import {
  composeBundle,
  composeInstruction,
  EmptyBundleError,
  sceneLines,
  shotLines,
  songLines,
  wordLines,
  worthComposing,
  type Bundle,
} from '../src/compose/index.ts';
import type { ExtractedScene } from '../src/extract/schema.ts';
import type { ExtractedShot } from '../src/extract/video.ts';
import type { ExtractedSong } from '../src/extract/audio.ts';
import type { ImaginedSong } from '../src/extract/idea.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import { loadBuiltinLibrary } from '../src/templates/load-node.ts';

const registry = await loadBuiltinRegistry();
const library = await loadBuiltinLibrary();

/** A photograph of a person, read. */
const PORTRAIT: ExtractedScene = {
  headline: 'a woman in a doorway',
  entities: [
    {
      name: 'the woman',
      type: 'person',
      description: 'mid-thirties, close-cropped dark hair, a scar through one eyebrow',
    },
  ],
  action: 'stands with one hand on the frame',
  location: 'a kitchen doorway',
  locationDescription: 'tiled splashback, a kettle on the hob',
  timeOfDay: 'morning',
  era: 'present day',
  shotSize: 'medium',
  angle: 'eye level',
  aspectRatio: '4:5',
  lightingKey: 'flat window light',
  lightingSources: [],
  contrast: 'low',
  colorTemp: 'neutral',
  opticsEffect: 'everything in focus',
  palette: ['#D8D2C8'],
  grade: 'plain',
  grain: 'none',
  medium: 'phone photograph',
  genre: 'snapshot',
  atmosphere: 'quiet',
  textInImage: [],
};

/** A photograph brought only for how it looks. */
const LOOK: ExtractedScene = {
  ...PORTRAIT,
  headline: 'a snowy street at dusk',
  entities: [],
  action: '',
  location: 'a snowy street',
  locationDescription: 'sodium lamps, tyre tracks',
  lightingKey: 'sodium street lamps through falling snow',
  contrast: 'high, deep blacks',
  colorTemp: 'warm lamps against blue snow',
  opticsEffect: 'halation around every light',
  palette: ['#0B1A2B', '#E0A44A'],
  grade: 'cold shadows, warm highlights',
  grain: 'heavy',
  medium: '35mm film still',
  genre: 'noir',
  atmosphere: 'snow drifting through lamplight',
};

const ANSWER: ExtractedScene = {
  ...PORTRAIT,
  headline: 'a woman in a doorway, lit like a winter street',
  lightingKey: 'sodium street lamps through falling snow',
  grade: 'cold shadows, warm highlights',
  grain: 'heavy',
  medium: '35mm film still',
};

const bundleOf = (items: Bundle['items'], modality: Bundle['modality'] = 'image'): Bundle => ({
  items,
  modality,
});

const WORDS = { id: 'words', kind: 'words' as const, role: 'auto' as const, lines: ['make her older'] };
const PICTURE = { id: 'her.png', kind: 'image' as const, role: 'auto' as const, lines: sceneLines(PORTRAIT) };
const STYLE = { id: 'street.png', kind: 'image' as const, role: 'style' as const, lines: sceneLines(LOOK) };

const gatewayWith = (answers: unknown[]) => new Gateway(new MockProvider(answers), { budgetUsd: 10 });

describe('a reading, reduced to lines', () => {
  it('keeps what was said and drops what was not', () => {
    const lines = sceneLines(PORTRAIT);

    expect(lines.some((l) => l.startsWith('Subject: a woman in a doorway'))).toBe(true);
    expect(lines.some((l) => l.includes('scar through one eyebrow'))).toBe(true);
    // Nothing empty gets a label of its own.
    expect(lines.every((l) => !/: *$/.test(l))).toBe(true);
    expect(lines.some((l) => l.startsWith('Grain'))).toBe(false);
  });

  it('adds movement for a video and nothing else', () => {
    const shot: ExtractedShot = {
      ...PORTRAIT,
      cameraMove: 'push-in',
      cameraSpeed: 'slow',
      subjectMotion: 'turns her head',
      beats: [{ t: '00:02', action: 'she lets go of the frame' }],
    };

    const lines = shotLines(shot);
    expect(lines).toContain('Movement: turns her head');
    expect(lines).toContain('Camera move: slow push-in');
    expect(lines).toContain('Beat 00:02: she lets go of the frame');
  });

  it('describes audio by what was heard of it', () => {
    const song: ExtractedSong = {
      genre: 'dusty americana',
      instruments: ['brushed drums', 'lap steel'],
      vocals: 'none',
      vocalDescription: '',
      structure: ['intro', 'verse'],
      mood: 'weary',
      mix: 'warm and close',
      uncertain: [],
    };

    expect(songLines(song)).toContain('Instruments: brushed drums, lap steel');
    expect(songLines(song)).toContain('Vocals: none');
  });

  it('takes words as they were typed', () => {
    expect(wordLines('  make her older  ')).toEqual(['make her older']);
    expect(wordLines('   ')).toEqual([]);
  });
});

describe('what the composer is told', () => {
  it('gives every source a name and a job', () => {
    const asked = composeInstruction(bundleOf([WORDS, PICTURE, STYLE]));

    expect(asked).toContain('What they typed (words) — job: auto');
    expect(asked).toContain('An image, read (her.png) — job: auto');
    expect(asked).toContain('An image, read (street.png) — job: style');
  });

  it('leaves out a source that says nothing', () => {
    const asked = composeInstruction(
      bundleOf([{ ...WORDS, lines: [] }, PICTURE]),
    );

    expect(asked).toContain('1 sources');
    expect(asked).not.toContain('(words)');
  });

  it('says a style source is only for how it looks', async () => {
    const provider = new MockProvider([ANSWER]);
    await composeBundle(new Gateway(provider), bundleOf([PICTURE, STYLE]));

    const system = provider.calls[0]?.system ?? '';
    expect(system).toContain('puts no snow in the picture');
    expect(system).toContain('Do not average');
  });

  it('sends no pictures, because the pictures have already been read', async () => {
    const provider = new MockProvider([ANSWER]);
    await composeBundle(new Gateway(provider), bundleOf([WORDS, PICTURE, STYLE]));

    expect(provider.calls[0]?.images).toBeUndefined();
    // The reading is in the question instead.
    expect(provider.calls[0]?.instruction).toContain('scar through one eyebrow');
  });

  it('knows whether there is anything to combine at all', () => {
    expect(worthComposing(bundleOf([PICTURE]))).toBe(false);
    expect(worthComposing(bundleOf([WORDS, PICTURE]))).toBe(true);
    expect(worthComposing(bundleOf([{ ...WORDS, lines: [] }, PICTURE]))).toBe(false);
  });
});

describe('the document it composes', () => {
  it('is one document, from one call', async () => {
    const provider = new MockProvider([ANSWER]);
    const { ir } = await composeBundle(new Gateway(provider), bundleOf([WORDS, PICTURE, STYLE]));

    expect(provider.calls).toHaveLength(1);
    expect(ir.subject?.entities?.[0]?.description).toContain('scar through one eyebrow');
    expect(ir.lighting?.key).toContain('sodium street lamps');
  });

  it('records which source was there for what', async () => {
    const { ir } = await composeBundle(gatewayWith([ANSWER]), bundleOf([WORDS, PICTURE, STYLE]));
    const by = new Map(ir.provenance?.map((p) => [p.ref, p.fields]));

    expect(by.get('street.png')).toContain('lighting');
    expect(by.get('street.png')).not.toContain('subject.headline');
    // A source nobody assigned a job claims nothing.
    expect(by.get('her.png')).toEqual([]);
  });

  it('refuses a bundle with nothing in it', async () => {
    await expect(
      composeBundle(gatewayWith([ANSWER]), bundleOf([{ ...WORDS, lines: ['  '] }])),
    ).rejects.toThrow(EmptyBundleError);
  });

  it('compiles like anything else', async () => {
    const { ir } = await composeBundle(gatewayWith([ANSWER]), bundleOf([WORDS, PICTURE, STYLE]));
    const { render, blocked } = compile(ir, getProfile(registry, 'nano-banana-2'));

    expect(blocked).toBe(false);
    expect(render.text).toContain('sodium street lamps');
    expect(render.text).toContain('scar through one eyebrow');
  });

  it('composes a video when a video is what is being made', async () => {
    const shot: ExtractedShot = {
      ...ANSWER,
      cameraMove: 'push-in',
      cameraSpeed: 'slow',
      subjectMotion: 'turns her head',
      beats: [],
    };

    const { ir } = await composeBundle(
      gatewayWith([shot]),
      bundleOf([WORDS, PICTURE, STYLE], 'video'),
    );

    expect(ir.modality).toBe('video');
    expect(ir.cameraMove).toEqual({ move: 'push-in', speed: 'slow' });
  });

  it('composes a piece of music when that is what is being made', async () => {
    const song: ImaginedSong = {
      genre: 'cold americana',
      bpm: 72,
      musicalKey: 'D minor',
      instruments: ['lap steel'],
      vocals: false,
      vocalDescription: '',
      structure: ['intro'],
      lyrics: '',
      mood: 'weary',
      mix: 'warm and close',
    };

    const { ir } = await composeBundle(gatewayWith([song]), bundleOf([WORDS, STYLE], 'audio'));

    expect(ir.modality).toBe('audio');
    expect(ir.audio?.bpm).toBe(72);
    expect(compile(ir, getProfile(registry, 'suno')).render.text).toContain('72 BPM');
  });

  it('does not reuse an answer bought for a different set of jobs', async () => {
    const gateway = gatewayWith([ANSWER, ANSWER]);

    const auto = await composeBundle(gateway, bundleOf([PICTURE, { ...STYLE, role: 'auto' }]));
    const styled = await composeBundle(gateway, bundleOf([PICTURE, STYLE]));
    expect(auto.key).not.toBe(styled.key);
  });
});

describe('composing into a template', () => {
  const FILLED = {
    product: 'a matte-black bottle',
    surface: 'wet slate',
    light: 'sodium lamps through falling snow',
  };

  it('answers the template questions from every source at once', async () => {
    const provider = new MockProvider([FILLED]);
    const { ir } = await composeBundle(new Gateway(provider), bundleOf([WORDS, PICTURE, STYLE]), {
      templateId: 'product-still',
      library,
    });

    expect(provider.calls[0]?.instruction).toContain('scar through one eyebrow');
    expect(provider.calls[0]?.instruction).toContain('Answer only the fields asked for');
    // The template still decides what it decided.
    expect(ir.subject?.headline).toBe('a matte-black bottle');
    expect(compile(ir, getProfile(registry, 'nano-banana-2')).blocked).toBe(false);
  });

  it('keeps the provenance of the sources it was built from', async () => {
    const { ir } = await composeBundle(gatewayWith([FILLED]), bundleOf([WORDS, PICTURE, STYLE]), {
      templateId: 'product-still',
      library,
    });

    expect(ir.provenance?.map((p) => p.ref)).toEqual(['words', 'her.png', 'street.png']);
  });

  it('says which template it does not have', async () => {
    await expect(
      composeBundle(gatewayWith([FILLED]), bundleOf([WORDS, PICTURE]), {
        templateId: 'nope',
        library,
      }),
    ).rejects.toThrow(/No template called "nope"/);
  });
});
