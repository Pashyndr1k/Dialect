import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import {
  extractFromAudio,
  measurementLines,
  songToIR,
  type ExtractedSong,
  type SongMeasurements,
} from '../src/extract/audio.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';

const registry = await loadBuiltinRegistry();

const PICTURES = [
  { mediaType: 'image/jpeg', base64: 'spectrogram-bytes' },
  { mediaType: 'image/jpeg', base64: 'waveform-bytes' },
];

const MEASURED: SongMeasurements = {
  reference: 'closing-time.mp3',
  durationS: 194.3,
  bpm: 78.4,
  musicalKey: 'A minor',
  lufs: -12.6,
  lra: 6.2,
};

const SONG: ExtractedSong = {
  genre: 'dusty americana',
  instruments: ['brushed drums', 'upright bass', 'lap steel'],
  vocals: 'present',
  vocalDescription: 'a low male voice, close and dry, sitting forward of the band',
  structure: ['intro', 'verse', 'chorus', 'verse', 'outro'],
  mood: 'world-weary and unhurried',
  mix: 'warm and dark, gently compressed, plenty of room around the drums',
  uncertain: ['whether the steel is a lap steel or a slide guitar'],
};

const gatewayWith = (answers: unknown[]) => new Gateway(new MockProvider(answers), { budgetUsd: 10 });

describe('what was measured', () => {
  it('is told to the model rather than asked of it', async () => {
    const provider = new MockProvider([SONG]);
    await extractFromAudio(new Gateway(provider), PICTURES, MEASURED);

    const asked = provider.calls[0]?.instruction ?? '';
    expect(asked).toContain('78 BPM');
    expect(asked).toContain('A minor');
    expect(asked).toContain('3:14');
    expect(asked).toContain('-12.6 LUFS');
  });

  it('turns a loudness number into what it means', () => {
    expect(measurementLines({ ...MEASURED, lufs: -6 }).join(' ')).toContain('mastered loud and flat');
    expect(measurementLines({ ...MEASURED, lufs: -20 }).join(' ')).toContain('quiet and dynamic');
    expect(measurementLines({ ...MEASURED, lufs: -12.6, lra: 2 }).join(' ')).toContain(
      'very little dynamic range',
    );
  });

  it('says nothing about what was not measured', () => {
    const lines = measurementLines({ reference: 'x.wav' }).join(' ');
    expect(lines).toBe('');
  });

  it('passes on what the file was tagged with', () => {
    const lines = measurementLines({
      ...MEASURED,
      title: 'Closing Time',
      artist: 'The Long Way',
      taggedGenre: 'Country',
    }).join(' ');

    expect(lines).toContain('titled "Closing Time"');
    expect(lines).toContain('by The Long Way');
    expect(lines).toContain('tagged as Country');
  });

  it('names which picture is which, so the model can read them apart', async () => {
    const provider = new MockProvider([SONG]);
    await extractFromAudio(new Gateway(provider), PICTURES, MEASURED);
    expect(provider.calls[0]?.instruction).toContain('first picture is a spectrogram');

    const one = new MockProvider([SONG]);
    await extractFromAudio(new Gateway(one), [PICTURES[0]!], MEASURED);
    expect(one.calls[0]?.instruction).toContain('The picture is a spectrogram');
  });

  it('refuses audio that produced nothing to look at', async () => {
    await expect(extractFromAudio(gatewayWith([SONG]), [], MEASURED)).rejects.toThrow(
      /nothing to look at/,
    );
  });
});

describe('the document it makes', () => {
  const ir = songToIR(SONG, MEASURED);

  it('takes the tempo and key from the measurement, not the answer', () => {
    expect(ir.audio?.bpm).toBe(78);
    expect(ir.audio?.musicalKey).toBe('A minor');
  });

  it('carries what the pictures did show', () => {
    expect(ir.audio?.genre).toBe('dusty americana');
    expect(ir.audio?.instruments).toContain('lap steel');
    expect(ir.audio?.structure).toEqual(['intro', 'verse', 'chorus', 'verse', 'outro']);
    expect(ir.mood?.emotion).toBe('world-weary and unhurried');
  });

  it('leaves the vocal question open rather than answering it', () => {
    const unsure = songToIR({ ...SONG, vocals: 'uncertain' }, MEASURED);
    expect(unsure.audio?.vocals).toBeUndefined();

    const silent = songToIR({ ...SONG, vocals: 'none' }, MEASURED);
    expect(silent.audio?.vocals).toEqual({ present: false });
  });

  it('records which fields came from the file', () => {
    expect(ir.provenance?.[0]?.ref).toBe('closing-time.mp3');
    expect(ir.provenance?.[0]?.fields).toContain('audio.bpm');
  });

  it('writes no lyrics, because none were heard', () => {
    expect(ir.audio?.lyrics).toBeUndefined();
  });
});

describe('audio becomes a prompt', () => {
  it('compiles to Suno with the measured tempo in it', async () => {
    const { ir } = await extractFromAudio(gatewayWith([SONG]), PICTURES, MEASURED);
    const { render, blocked } = compile(ir, getProfile(registry, 'suno'));

    expect(blocked).toBe(false);
    const style = render.segments.find((s) => s.label === 'Style')?.text ?? '';
    expect(style).toContain('dusty americana');
    expect(style).toContain('78 BPM');
    expect(style).toContain('A minor');
  });

  it('says it is instrumental when nothing sang', async () => {
    const { ir } = await extractFromAudio(
      gatewayWith([{ ...SONG, vocals: 'none', vocalDescription: '' }]),
      PICTURES,
      MEASURED,
    );

    const { render } = compile(ir, getProfile(registry, 'suno'));
    expect(render.segments.find((s) => s.label === 'Lyrics')?.text).toBe('[Instrumental]');
  });

  it('compiles to Stable Audio from the same reading', async () => {
    const { ir } = await extractFromAudio(gatewayWith([SONG]), PICTURES, MEASURED);
    const text = compile(ir, getProfile(registry, 'stable-audio')).render.text;

    expect(text).toContain('dusty americana');
    expect(text.split('\n')).toHaveLength(1);
  });
});
