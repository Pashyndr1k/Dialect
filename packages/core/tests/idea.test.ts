import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import {
  EmptyIdeaError,
  expandIdea,
  fillTemplate,
  ideaLabel,
  imaginedToIR,
  type ImaginedSong,
} from '../src/extract/idea.ts';
import type { ExtractedScene } from '../src/extract/schema.ts';
import type { ExtractedShot } from '../src/extract/video.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import { loadBuiltinLibrary } from '../src/templates/load-node.ts';

const registry = await loadBuiltinRegistry();
const library = await loadBuiltinLibrary();

const SCENE: ExtractedScene = {
  headline: 'a red door in the rain',
  entities: [
    { name: 'the door', type: 'object', description: 'a red-painted door, paint blistered at the foot' },
  ],
  action: '',
  location: 'a narrow terraced street',
  locationDescription: 'wet brick, a gutter running',
  timeOfDay: 'late afternoon',
  era: 'present day',
  shotSize: 'medium',
  angle: 'straight on',
  aspectRatio: '4:5',
  lightingKey: 'flat overcast light',
  lightingSources: [],
  contrast: 'low',
  colorTemp: 'cool',
  opticsEffect: 'rain streaks read sharp against a soft background',
  palette: ['#8C1C13', '#3F3F3F'],
  grade: 'desaturated but for the door',
  grain: 'fine-uniform',
  medium: 'photograph',
  genre: 'documentary',
  atmosphere: 'rain bouncing off the step',
  textInImage: [],
};

const SHOT: ExtractedShot = {
  ...SCENE,
  action: 'the door swings inward',
  cameraMove: 'push-in',
  cameraSpeed: 'slow',
  subjectMotion: 'the door swings inward',
  beats: [],
};

const SONG: ImaginedSong = {
  genre: 'sparse lullaby',
  bpm: 62,
  musicalKey: 'F major',
  instruments: ['celesta', 'a single sustained cello', 'brushed snare'],
  vocals: false,
  vocalDescription: '',
  structure: ['intro', 'theme', 'variation', 'outro'],
  lyrics: '',
  mood: 'unhurried and safe',
  mix: 'warm and close, plenty of air above',
};

const gatewayWith = (answers: unknown[]) => new Gateway(new MockProvider(answers), { budgetUsd: 10 });

describe('an idea becomes a document', () => {
  it('refuses nothing at all, which is not an idea', async () => {
    for (const empty of ['', '   ', '\n\t ']) {
      await expect(expandIdea(gatewayWith([SCENE]), empty, { modality: 'image' })).rejects.toThrow(
        EmptyIdeaError,
      );
    }
  });

  it('takes one word, because one word is something', async () => {
    const { ir } = await expandIdea(gatewayWith([SCENE]), 'saloon', { modality: 'image' });
    expect(ir.subject?.headline).toBe('a red door in the rain');
  });

  it('passes the words on unchanged', async () => {
    const provider = new MockProvider([SCENE]);
    await expandIdea(new Gateway(provider), '  a red door in the rain  ', { modality: 'image' });

    expect(provider.calls[0]?.instruction).toContain('"a red door in the rain"');
    // Writing is not reading: it is told to decide, not to withhold.
    expect(provider.calls[0]?.system).toContain('Decide.');
  });

  it('asks for a shot when the target makes clips', async () => {
    const provider = new MockProvider([SHOT]);
    const { ir } = await expandIdea(new Gateway(provider), 'a door opening', { modality: 'video' });

    expect(ir.modality).toBe('video');
    expect(ir.cameraMove).toEqual({ move: 'push-in', speed: 'slow' });
    expect(provider.calls[0]?.system).toContain('One action for the subject');
  });

  it('asks for a song when the target makes music', async () => {
    const { ir } = await expandIdea(gatewayWith([SONG]), 'a lullaby for a rainy night', {
      modality: 'audio',
    });

    expect(ir.modality).toBe('audio');
    expect(ir.audio?.bpm).toBe(62);
    expect(ir.audio?.musicalKey).toBe('F major');
    expect(ir.audio?.instruments).toContain('celesta');
  });

  it('records the idea as the source of what it produced', async () => {
    const { ir } = await expandIdea(gatewayWith([SCENE]), 'a red door in the rain', {
      modality: 'image',
    });
    expect(ir.provenance?.[0]?.ref).toBe('a red door in the rain');
  });

  it('shortens a long idea rather than putting a paragraph in the label', () => {
    expect(ideaLabel('a  red   door')).toBe('a red door');
    const long = ideaLabel('x'.repeat(80));
    expect(long).toHaveLength(40);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('an imagined song', () => {
  it('leaves the lyric box empty rather than putting an empty string in it', () => {
    expect(imaginedToIR(SONG, 'idea').audio?.lyrics).toBeUndefined();
    expect(imaginedToIR({ ...SONG, lyrics: '   ' }, 'idea').audio?.lyrics).toBeUndefined();
  });

  it('carries words through when there are words', () => {
    const sung = imaginedToIR({ ...SONG, vocals: true, lyrics: '[Verse]\nRain on the roof' }, 'idea');
    expect(sung.audio?.lyrics).toContain('Rain on the roof');
    expect(sung.audio?.vocals?.present).toBe(true);
  });

  it('compiles to Suno with the tempo it chose', () => {
    const { render, blocked } = compile(imaginedToIR(SONG, 'idea'), getProfile(registry, 'suno'));

    expect(blocked).toBe(false);
    expect(render.text).toContain('62 BPM');
    expect(render.segments.find((s) => s.label === 'Lyrics')?.text).toBe('[Instrumental]');
  });
});

describe('an idea inside a template', () => {
  const FILLED = {
    subject: 'a weathered cowboy in his late sixties',
    details: 'silver stubble, a dust-covered duster coat, a hat brim worn soft',
    action: 'leans on the bar',
    location: 'a frontier saloon',
    light: 'warm oil lanterns from the ceiling beams',
  };

  const shapeOf = (provider: MockProvider): Record<string, { description?: string }> =>
    (provider.calls[0]!.schema as unknown as { shape: Record<string, { description?: string }> })
      .shape;

  it('asks only the questions the template asks', async () => {
    const provider = new MockProvider([FILLED]);
    await fillTemplate(new Gateway(provider), 'a cowboy at a bar', library, 'cinematic-shot');

    expect(new Set(Object.keys(shapeOf(provider)))).toEqual(new Set(Object.keys(FILLED)));
  });

  it('hands the template its own hints to the model as the field descriptions', async () => {
    const provider = new MockProvider([FILLED]);
    await fillTemplate(new Gateway(provider), 'a cowboy at a bar', library, 'cinematic-shot');

    expect(shapeOf(provider)['action']?.description).toContain(
      'One action. A second one belongs in the next shot.',
    );
  });

  it('lets the template decide everything it decided', async () => {
    const { ir } = await fillTemplate(
      gatewayWith([FILLED]),
      'a cowboy at a bar',
      library,
      'cinematic-shot',
    );

    // The idea filled the holes; the template kept its own choices.
    expect(ir.subject?.action).toBe('leans on the bar');
    expect(ir.shot?.aspectRatio).toBe('16:9');
    expect(ir.cameraMove?.move).toBe('push-in');
    expect(ir.modality).toBe('video');
  });

  it('names the document after the idea when the template did not', async () => {
    const { ir } = await fillTemplate(
      gatewayWith([FILLED]),
      'a cowboy at a bar',
      library,
      'cinematic-shot',
    );
    expect(ir.title).toBe('a cowboy at a bar');
  });

  it('compiles from a template-filled document', async () => {
    const { ir } = await fillTemplate(
      gatewayWith([FILLED]),
      'a cowboy at a bar',
      library,
      'cinematic-shot',
    );
    const { render, blocked } = compile(ir, getProfile(registry, 'kling-3-omni'));

    expect(blocked).toBe(false);
    expect(render.text).toContain('leans on the bar');
    expect(render.text).toContain('a frontier saloon');
  });

  it('will not reuse an answer bought for a different template', async () => {
    const gateway = new Gateway(
      new MockProvider([
        FILLED,
        { product: 'a matte-black bottle', surface: 'wet slate', light: 'hard raking light' },
      ]),
      { budgetUsd: 10 },
    );

    // Same words, different template: the same answer would be the wrong shape.
    const one = await fillTemplate(gateway, 'a bottle on slate', library, 'cinematic-shot');
    const two = await fillTemplate(gateway, 'a bottle on slate', library, 'product-still');

    expect(one.key).not.toBe(two.key);
    expect(one.ir.modality).toBe('video');
    expect(two.ir.modality).toBe('image');
  });

  it('says which template it does not have', async () => {
    await expect(
      fillTemplate(gatewayWith([FILLED]), 'anything', library, 'no-such-template'),
    ).rejects.toThrow(/No template called "no-such-template"/);
  });

  it('still refuses an empty idea', async () => {
    await expect(fillTemplate(gatewayWith([FILLED]), '  ', library, 'cinematic-shot')).rejects.toThrow(
      EmptyIdeaError,
    );
  });
});
