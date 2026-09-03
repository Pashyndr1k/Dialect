import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { extractFromVideo, shotToIR, type ExtractedShot } from '../src/extract/video.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';

const registry = await loadBuiltinRegistry();

const FRAMES = [0.3, 1.9, 3.5, 5.1, 6.1].map((at) => ({
  mediaType: 'image/jpeg',
  base64: `frame-at-${at}`,
}));

const SHOT: ExtractedShot = {
  headline: 'a cowboy leaning on a saloon bar',
  entities: [
    {
      name: 'aged cowboy',
      type: 'person',
      description: 'a weathered man in his late sixties, silver stubble, a dust-covered duster coat',
    },
  ],
  action: 'leans on the bar',
  location: 'a frontier saloon',
  locationDescription: 'a long scratched counter, whiskey bottles against a cracked mirror',
  timeOfDay: 'mid-afternoon',
  era: '1880s',
  shotSize: 'medium',
  angle: 'slightly below eye level',
  aspectRatio: '16:9',
  lightingKey: 'warm oil lanterns from the ceiling beams',
  lightingSources: ['a shaft of afternoon sun through the doors'],
  contrast: 'high, with deep corners',
  colorTemp: 'warm amber',
  opticsEffect: 'the back of the room falls away into soft blur',
  palette: ['#2B1D12', '#A8690A'],
  grade: 'warm, muted',
  grain: 'fine-uniform',
  medium: 'film still',
  genre: 'western',
  atmosphere: 'dust drifting through the light',
  textInImage: [],
  cameraMove: 'push-in',
  cameraSpeed: 'slow',
  subjectMotion: 'raises a shot glass without drinking from it',
  beats: [
    { t: '00:00', action: 'he rests both forearms on the bar' },
    { t: '00:04', action: 'he lifts the glass' },
  ],
};

const gatewayWith = (answers: unknown[]) =>
  new Gateway(new MockProvider(answers), { budgetUsd: 10 });

describe('reading a video', () => {
  it('takes its motion from the shot and its scene from the frames', async () => {
    const { ir } = await extractFromVideo(gatewayWith([SHOT]), FRAMES, {
      reference: 'saloon.mp4',
      durationS: 6.44,
      aspectRatio: '16:9',
    });

    expect(ir.modality).toBe('video');
    expect(ir.cameraMove).toEqual({ move: 'push-in', speed: 'slow' });
    expect(ir.subject?.action).toBe('raises a shot glass without drinking from it');
    expect(ir.environment?.location).toBe('a frontier saloon');
    expect(ir.beats).toHaveLength(2);
  });

  it('takes the duration from the container rather than asking the model', async () => {
    const provider = new MockProvider([SHOT]);
    const { ir } = await extractFromVideo(new Gateway(provider), FRAMES, {
      reference: 'saloon.mp4',
      durationS: 6.44,
    });

    expect(ir.shot?.durationS).toBe(6.4);
    // And it is told, so it is not left to guess at something measured.
    expect(provider.calls[0]?.instruction).toContain('6.4 seconds');
  });

  it('sends every frame, in order, as one question', async () => {
    const provider = new MockProvider([SHOT]);
    await extractFromVideo(new Gateway(provider), FRAMES, { reference: 'saloon.mp4' });

    const sent = provider.calls[0]?.images ?? [];
    expect(sent).toHaveLength(5);
    expect(sent.map((i) => i.base64)).toEqual(FRAMES.map((f) => f.base64));
  });

  it('refuses a video that produced nothing to look at', async () => {
    await expect(
      extractFromVideo(gatewayWith([SHOT]), [], { reference: 'empty.mp4' }),
    ).rejects.toThrow(/nothing to look at/);
  });

  it('carries no lens number, because none is visible in a frame', () => {
    const ir = shotToIR(SHOT, { reference: 'saloon.mp4' });
    expect(ir.optics?.gearHint).toBeUndefined();
    expect(ir.optics?.effect).toContain('falls away into soft blur');
  });

  it('leaves beats out when the shot holds one moment', () => {
    const held = shotToIR({ ...SHOT, beats: [] }, { reference: 'saloon.mp4' });
    expect(held.beats).toBeUndefined();
  });
});

describe('a video becomes a prompt', () => {
  it('compiles to Kling with its movement intact', async () => {
    const { ir } = await extractFromVideo(gatewayWith([SHOT]), FRAMES, {
      reference: 'saloon.mp4',
      durationS: 6.44,
      aspectRatio: '16:9',
    });

    const result = compile(ir, getProfile(registry, 'kling-3-omni'));

    expect(result.blocked).toBe(false);
    expect(result.render.text).toContain('Movement: raises a shot glass');
    expect(result.render.text).toContain('slow push-in');
    expect(result.render.params['duration']).toBe('6.4 seconds');
  });

  it('compiles to Seedance from the same reading', async () => {
    const { ir } = await extractFromVideo(gatewayWith([SHOT]), FRAMES, {
      reference: 'saloon.mp4',
      durationS: 6.44,
    });

    const text = compile(ir, getProfile(registry, 'seedance-2.5')).render.text;
    expect(text).toContain('slow push-in');
    // Seedance ignores lens numbers, and there was never one to ignore.
    expect(text).not.toMatch(/\d+mm/);
  });

  it('is held to the same rules as anything else', async () => {
    const twoActions: ExtractedShot = {
      ...SHOT,
      subjectMotion: 'lifts the glass and then turns to the doors',
    };
    const { ir } = await extractFromVideo(gatewayWith([twoActions]), FRAMES, {
      reference: 'saloon.mp4',
    });

    const result = compile(ir, getProfile(registry, 'kling-3-omni'));
    expect(result.blocked).toBe(true);
    expect(result.findings.map((f) => f.ruleId)).toContain('one-action-one-move');
  });

  it('blocks a video longer than the target makes', async () => {
    const { ir } = await extractFromVideo(gatewayWith([SHOT]), FRAMES, {
      reference: 'long.mp4',
      durationS: 40,
    });

    const result = compile(ir, getProfile(registry, 'kling-3-omni'));
    expect(result.findings.map((f) => f.ruleId)).toContain('clip-duration-limit');
  });
});
