import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { extractFromImages } from '../src/extract/image.ts';
import { extractFromVideo, type ExtractedShot } from '../src/extract/video.ts';
import { extractFromAudio, type ExtractedSong } from '../src/extract/audio.ts';
import { fillTemplate, EmptyIdeaError } from '../src/extract/idea.ts';
import type { ExtractedScene } from '../src/extract/schema.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import { loadBuiltinLibrary } from '../src/templates/load-node.ts';

const registry = await loadBuiltinRegistry();
const library = await loadBuiltinLibrary();

const IMAGE = { mediaType: 'image/png', base64: 'first-reference' };
const SECOND = { mediaType: 'image/png', base64: 'second-reference' };

const SCENE: ExtractedScene = {
  headline: 'a cowboy at a saloon bar',
  entities: [{ name: 'the cowboy', type: 'person', description: 'a weathered man, silver stubble' }],
  action: 'leans on the bar',
  location: 'a frontier saloon',
  locationDescription: 'a long scratched counter',
  timeOfDay: 'night',
  era: '1880s',
  shotSize: 'medium',
  angle: 'eye level',
  aspectRatio: '4:5',
  lightingKey: 'a single oil lantern',
  lightingSources: [],
  contrast: 'high',
  colorTemp: 'warm',
  opticsEffect: 'the room falls into soft blur',
  palette: ['#2B1D12'],
  grade: 'warm, muted',
  grain: 'fine-uniform',
  medium: 'film still',
  genre: 'western',
  atmosphere: 'dust in the lantern light',
  textInImage: [],
};

const gatewayWith = (answers: unknown[]) => new Gateway(new MockProvider(answers), { budgetUsd: 10 });

describe('a reference and some words, together', () => {
  it('goes as one question rather than two answers merged', async () => {
    const provider = new MockProvider([SCENE]);
    await extractFromImages(new Gateway(provider), [IMAGE], {
      reference: 'cowboy.png',
      note: 'make it night, and older',
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.images).toHaveLength(1);
    expect(provider.calls[0]?.instruction).toContain('make it night, and older');
  });

  it('says which is what exists and which is what they want', async () => {
    const provider = new MockProvider([SCENE]);
    await extractFromImages(new Gateway(provider), [IMAGE], {
      reference: 'cowboy.png',
      note: 'at night',
    });

    const asked = provider.calls[0]?.instruction ?? '';
    expect(asked).toContain('reference as what exists');
    // And the answer has to read as a description, not as a diff.
    expect(asked).toContain('do not describe the change');
  });

  it('asks the plain question when nothing was said', async () => {
    const provider = new MockProvider([SCENE]);
    await extractFromImages(new Gateway(provider), [IMAGE], { reference: 'cowboy.png' });

    expect(provider.calls[0]?.instruction).not.toContain('The person also said');
  });

  it('treats an empty note as no note', async () => {
    const provider = new MockProvider([SCENE]);
    await extractFromImages(new Gateway(provider), [IMAGE], {
      reference: 'cowboy.png',
      note: '   ',
    });

    expect(provider.calls[0]?.instruction).not.toContain('The person also said');
  });

  it('is a different question, so it does not reuse the plain answer', async () => {
    const gateway = gatewayWith([SCENE, SCENE]);

    const plain = await extractFromImages(gateway, [IMAGE], { reference: 'cowboy.png' });
    const noted = await extractFromImages(gateway, [IMAGE], {
      reference: 'cowboy.png',
      note: 'at night',
    });

    expect(plain.key).not.toBe(noted.key);
  });

  it('carries a note into a clip and into a track', async () => {
    const shot: ExtractedShot = {
      ...SCENE,
      cameraMove: 'push-in',
      cameraSpeed: 'slow',
      subjectMotion: 'lifts the glass',
      beats: [],
    };
    const clip = new MockProvider([shot]);
    await extractFromVideo(new Gateway(clip), [IMAGE], {
      reference: 'saloon.mp4',
      note: 'slower, and in the rain',
    });
    expect(clip.calls[0]?.instruction).toContain('slower, and in the rain');

    const song: ExtractedSong = {
      genre: 'americana',
      instruments: ['guitar'],
      vocals: 'none',
      vocalDescription: '',
      structure: ['intro'],
      mood: 'weary',
      mix: 'warm',
      uncertain: [],
    };
    const track = new MockProvider([song]);
    await extractFromAudio(new Gateway(track), [IMAGE], {
      reference: 'x.mp3',
      note: 'half the tempo',
    });
    expect(track.calls[0]?.instruction).toContain('half the tempo');
  });
});

describe('several stills at once', () => {
  it('reads them as one scene rather than one at a time', async () => {
    const provider = new MockProvider([SCENE]);
    await extractFromImages(new Gateway(provider), [IMAGE, SECOND], { reference: 'two.png' });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.images?.map((i) => i.base64)).toEqual([
      IMAGE.base64,
      SECOND.base64,
    ]);
    expect(provider.calls[0]?.instruction).toContain('one subject seen more than once');
  });

  it('says which one is being made when they disagree', async () => {
    const provider = new MockProvider([SCENE]);
    await extractFromImages(new Gateway(provider), [IMAGE, SECOND], { reference: 'two.png' });
    expect(provider.calls[0]?.instruction).toContain('the first one is the one being made');
  });

  it('refuses to read nothing', async () => {
    await expect(
      extractFromImages(gatewayWith([SCENE]), [], { reference: 'none' }),
    ).rejects.toThrow(/nothing was attached/);
  });

  it('still compiles to a prompt', async () => {
    const { ir } = await extractFromImages(gatewayWith([SCENE]), [IMAGE, SECOND], {
      reference: 'two.png',
      note: 'at night',
    });
    const { render, blocked } = compile(ir, getProfile(registry, 'nano-banana-2'));

    expect(blocked).toBe(false);
    // Capitalised by the dialect's own assembly, which is the point of a dialect.
    expect(render.text).toContain('A cowboy at a saloon bar');
  });
});

describe('a reference filling a template', () => {
  const FILLED = {
    subject: 'a weathered cowboy in his late sixties',
    details: 'silver stubble, a dust-covered duster coat',
    action: 'leans on the bar',
    location: 'a frontier saloon',
    light: 'a single oil lantern',
  };

  it('takes the fields from the picture rather than from words alone', async () => {
    const provider = new MockProvider([FILLED]);
    await fillTemplate(new Gateway(provider), '', library, 'cinematic-shot', [IMAGE]);

    expect(provider.calls[0]?.images).toHaveLength(1);
    expect(provider.calls[0]?.system).toContain('You are also shown a reference');
    expect(provider.calls[0]?.instruction).toContain('nothing said about it');
  });

  it('lets words steer what the picture shows', async () => {
    const provider = new MockProvider([FILLED]);
    await fillTemplate(new Gateway(provider), 'make him older', library, 'cinematic-shot', [IMAGE]);

    expect(provider.calls[0]?.instruction).toContain('make him older');
    expect(provider.calls[0]?.system).toContain('follow their words');
  });

  it('needs words only when there is no reference', async () => {
    await expect(fillTemplate(gatewayWith([FILLED]), '  ', library, 'cinematic-shot')).rejects.toThrow(
      EmptyIdeaError,
    );

    // With a reference, silence is a fair answer.
    const { ir } = await fillTemplate(gatewayWith([FILLED]), '', library, 'cinematic-shot', [IMAGE]);
    expect(ir.subject?.action).toBe('leans on the bar');
  });

  it('names the document after the template when nobody said anything', async () => {
    const { ir } = await fillTemplate(gatewayWith([FILLED]), '', library, 'cinematic-shot', [IMAGE]);
    expect(ir.title).toBe('Cinematic shot');
  });

  it('still keeps everything the template decided', async () => {
    const { ir } = await fillTemplate(
      gatewayWith([FILLED]),
      'at night',
      library,
      'cinematic-shot',
      [IMAGE],
    );

    expect(ir.shot?.aspectRatio).toBe('16:9');
    expect(ir.cameraMove?.move).toBe('push-in');
    expect(compile(ir, getProfile(registry, 'kling-3-omni')).blocked).toBe(false);
  });

  it('does not hand back the wordless answer when words were added', async () => {
    const gateway = gatewayWith([FILLED, FILLED]);

    const bare = await fillTemplate(gateway, '', library, 'cinematic-shot', [IMAGE]);
    const noted = await fillTemplate(gateway, 'make him older', library, 'cinematic-shot', [IMAGE]);
    expect(bare.key).not.toBe(noted.key);
  });
});
