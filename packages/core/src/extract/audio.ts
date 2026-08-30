/**
 * Reading a track.
 *
 * A model cannot listen, and unlike a clip there is no frame to show it. So the
 * job splits by what each side is actually good at.
 *
 * Tempo, key, length and loudness are measured by the host and arrive here as
 * fact. They go into the question, never into the schema — asking a model to
 * guess at something already counted invites a confident wrong number, and a
 * prompt that says 140 BPM about a 90 BPM track is worse than one that says
 * nothing about tempo at all.
 *
 * What is left is judgement: genre, instruments, how it feels, where the
 * sections change. That goes to the model with a picture of the sound. A
 * spectrogram genuinely shows density, brightness, dynamics and structure. It
 * does not show what a saxophone is, and the prompt below says so.
 */

import { z } from 'zod';
import type { Gateway } from '../providers/gateway.ts';
import type { ImagePart, ProviderUsage } from '../providers/types.ts';
import type { PromptIR } from '../ir/types.ts';
import { IR_VERSION } from '../ir/types.ts';
import { notedInstruction } from './prompt.ts';

const withNote = (base: string, note?: string): string =>
  note?.trim() ? notedInstruction(base, note) : base;

/** Bumped whenever this schema or the prompt below changes. */
export const SONG_VERSION = '1';

export const ExtractedSong = z.object({
  genre: z
    .string()
    .describe('the closest genre, or a phrase for the sound if no genre fits'),
  instruments: z
    .array(z.string())
    .describe('only what the pictures support. A short honest list, not a long invented one.'),
  vocals: z
    .enum(['none', 'present', 'uncertain'])
    .describe('whether a sustained human voice is visible in the spectrogram'),
  vocalDescription: z
    .string()
    .describe('how the voice sits in the mix, if there is one. Empty otherwise.'),
  structure: z
    .array(z.string())
    .describe('section labels in order, read from where the picture changes texture'),
  mood: z.string().describe('how it feels, in a phrase'),
  mix: z
    .string()
    .describe('how it is produced: bright or dark, dry or reverberant, dense or sparse'),
  uncertain: z
    .array(z.string())
    .describe('what the pictures could not settle. Empty if nothing.'),
});

export type ExtractedSong = z.infer<typeof ExtractedSong>;

export const SONG_SYSTEM = `You are shown pictures of a piece of music rather
than the music itself: a spectrogram, with frequency up the side, time across
and brightness for energy; and below it a waveform, amplitude across time.

They show a great deal. How dense the arrangement is. Whether it is bright or
dark. Where sections begin and end, because the texture changes at the seam.
Whether the dynamics move or sit flat and compressed. Whether percussion is
prominent, which reads as regular vertical strikes. Whether a sustained voice is
present, which reads as a band of moving harmonics.

They do not show what a saxophone is. Where a picture cannot settle a question,
put it in "uncertain" rather than naming an instrument you cannot see. A short
honest list is worth more than a long invented one, because everything you name
will be generated.

The tempo, key, length and loudness have already been measured and are given to
you below. Do not restate them and do not contradict them.`;

export interface SongMeasurements {
  /** Label recorded in provenance, normally the file name. */
  reference: string;
  /** What the person said alongside the track. See `ExtractOptions.note`. */
  note?: string;
  durationS?: number;
  bpm?: number;
  /** e.g. `A minor`. */
  musicalKey?: string;
  /** Integrated loudness. */
  lufs?: number;
  /** Loudness range: how far the quiet and loud parts sit apart. */
  lra?: number;
  /** Whatever the file was tagged with, if anything. */
  title?: string;
  artist?: string;
  taggedGenre?: string;
}

export interface SongResult {
  ir: PromptIR;
  song: ExtractedSong;
  usage: ProviderUsage;
  cached: boolean;
  key: string;
}

const minutes = (seconds: number): string => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** The measured facts, written out as the question's closing paragraph. */
export function measurementLines(m: SongMeasurements): string[] {
  const lines: string[] = [];

  if (m.durationS !== undefined && m.durationS > 0) lines.push(`It runs ${minutes(m.durationS)}.`);
  if (m.bpm !== undefined) lines.push(`The tempo is ${Math.round(m.bpm)} BPM.`);
  if (m.musicalKey) lines.push(`The key is ${m.musicalKey}.`);

  if (m.lufs !== undefined) {
    // A number nobody reads on its own, turned into the thing it means.
    const how = m.lufs > -9 ? 'mastered loud and flat' : m.lufs > -14 ? 'mastered for streaming' : 'quiet and dynamic';
    const range = m.lra !== undefined && m.lra < 4 ? ', with very little dynamic range' : '';
    lines.push(`It is ${how} at ${m.lufs.toFixed(1)} LUFS${range}.`);
  }

  const tagged = [
    m.title ? `titled "${m.title}"` : '',
    m.artist ? `by ${m.artist}` : '',
    m.taggedGenre ? `tagged as ${m.taggedGenre}` : '',
  ].filter(Boolean);
  if (tagged.length > 0) lines.push(`The file is ${tagged.join(', ')}.`);

  return lines;
}

export function songToIR(song: ExtractedSong, m: SongMeasurements): PromptIR {
  const instruments = song.instruments.map((i) => i.trim()).filter(Boolean);
  const structure = song.structure.map((s) => s.trim()).filter(Boolean);

  const fields = [
    'audio.genre',
    ...(m.bpm !== undefined ? ['audio.bpm'] : []),
    ...(m.musicalKey ? ['audio.musicalKey'] : []),
    ...(instruments.length > 0 ? ['audio.instruments'] : []),
    ...(structure.length > 0 ? ['audio.structure'] : []),
    'audio.mix',
    ...(song.mood.trim() ? ['mood.emotion'] : []),
  ];

  return {
    irVersion: IR_VERSION,
    modality: 'audio',
    mode: 'generate',
    ...(m.title ? { title: m.title } : { title: m.reference }),
    audio: {
      genre: song.genre,
      // Measured, not asked for. Rounded, because nobody writes 119.7 BPM.
      ...(m.bpm !== undefined ? { bpm: Math.round(m.bpm) } : {}),
      ...(m.musicalKey ? { musicalKey: m.musicalKey } : {}),
      ...(instruments.length > 0 ? { instruments } : {}),
      ...(structure.length > 0 ? { structure } : {}),
      // `uncertain` is not a guess to carry forward: a voice nobody could see
      // is a voice the prompt should not ask for.
      ...(song.vocals === 'none'
        ? { vocals: { present: false } }
        : song.vocals === 'present'
          ? {
              vocals: {
                present: true,
                ...(song.vocalDescription.trim() ? { description: song.vocalDescription } : {}),
              },
            }
          : {}),
      ...(song.mix.trim() ? { mix: song.mix } : {}),
    },
    ...(song.mood.trim() ? { mood: { emotion: song.mood } } : {}),
    provenance: [{ ref: m.reference, fields }],
  };
}

export async function extractFromAudio(
  gateway: Gateway,
  pictures: ImagePart[],
  m: SongMeasurements,
): Promise<SongResult> {
  if (pictures.length === 0) {
    throw new Error('No pictures of the sound: ffmpeg produced nothing to look at.');
  }

  const named =
    pictures.length > 1
      ? 'The first picture is a spectrogram; the second is the waveform.'
      : 'The picture is a spectrogram.';

  const result = await gateway.extract({
    system: SONG_SYSTEM,
    instruction: withNote(
      [
        `${named} Describe this track so something like it could be written.`,
        ...measurementLines(m),
      ].join(' '),
      m.note,
    ),
    images: pictures,
    schema: ExtractedSong,
    schemaVersion: SONG_VERSION,
  });

  return {
    ir: songToIR(result.value, m),
    song: result.value,
    usage: result.usage,
    cached: result.cached,
    key: result.key,
  };
}
