/**
 * Reading a video.
 *
 * A vision model cannot watch anything, so a video arrives as a handful of
 * images taken in order across its length. Everything an image cannot show —
 * that the camera is pushing in, that a hand is rising — has to be inferred
 * from how the frames differ, which is the whole reason they are described as
 * an ordered set rather than as separate pictures.
 *
 * What comes back is deliberately shaped like a shot rather than a scene: one
 * action, one camera move, because that is what the engine rules will hold it
 * to and what the video dialects have a slot for.
 */

import { z } from 'zod';
import type { Gateway } from '../providers/gateway.ts';
import type { ImagePart, ProviderUsage } from '../providers/types.ts';
import type { PromptIR } from '../ir/types.ts';
import { CAMERA_MOVES, IR_VERSION } from '../ir/types.ts';
import { ExtractedScene } from './schema.ts';
import { sceneToIR } from './image.ts';
import { notedInstruction } from './prompt.ts';

const withNote = (base: string, note?: string): string =>
  note?.trim() ? notedInstruction(base, note) : base;

/** Bumped whenever this schema or the prompt below changes. */
export const SHOT_VERSION = '1';

export const ExtractedShot = ExtractedScene.extend({
  cameraMove: z
    // The same list the IR takes, so the schema cannot drift from what a
    // renderer knows how to write down.
    .enum(CAMERA_MOVES)
    .describe('the one move the camera makes across these frames, or static if it holds'),
  cameraSpeed: z.enum(['slow', 'medium', 'fast']),
  subjectMotion: z
    .string()
    .describe('the one thing the subject does, as an action. Not a list of everything that moves.'),
  beats: z
    .array(z.object({ t: z.string().describe('mm:ss'), action: z.string() }))
    .describe('what happens and when, one action each. Empty if the shot holds one moment.'),
});

export type ExtractedShot = z.infer<typeof ExtractedShot>;

export const SHOT_SYSTEM = `You are shown several frames taken in order from a
single video clip, evenly spaced across its length. They are one shot, not
separate pictures.

Describe that shot so it could be rebuilt from your description alone.

Read the movement from the differences between frames. If the framing tightens
the camera is pushing in; if it slides sideways while the subject stays put it
is tracking or panning; if nothing changes but the subject, the camera is
static. Say which one it is. Do not invent a move you cannot see evidence for —
static is a real answer and a common one.

Name one action for the subject. A shot has one; a list of everything that moves
in frame is not what any video model can execute.

Report optics by the visible result, never by equipment. Focal lengths and
apertures cannot be read off a picture and are not useful downstream.

Describe mood physically — what a camera recorded, not what someone felt.

Where the frames genuinely do not tell you something, say so plainly instead of
inventing a plausible detail.`;

export const SHOT_INSTRUCTION =
  'These frames are one shot, in order. Describe it so the shot can be rebuilt.';

export interface ShotOptions {
  /** Label recorded in provenance, normally the file name. */
  reference: string;
  /** What the person said alongside the video. See `ExtractOptions.note`. */
  note?: string;
  /** From the container, so the model is not asked to guess it. */
  durationS?: number;
  aspectRatio?: string;
}

export interface ShotResult {
  ir: PromptIR;
  shot: ExtractedShot;
  usage: ProviderUsage;
  cached: boolean;
  key: string;
}

export function shotToIR(shot: ExtractedShot, options: ShotOptions): PromptIR {
  // The scene half maps exactly as an image does; only the motion is new.
  const base = sceneToIR(shot, { reference: options.reference, modality: 'video' });

  const beats = shot.beats.filter((b) => b.action.trim().length > 0);

  return {
    ...base,
    irVersion: IR_VERSION,
    modality: 'video',
    subject: {
      ...base.subject,
      // What the subject does comes from the movement, not from the image.
      ...(shot.subjectMotion.trim() ? { action: shot.subjectMotion } : {}),
    },
    shot: {
      ...base.shot,
      ...(options.durationS !== undefined
        ? { durationS: Math.round(options.durationS * 10) / 10 }
        : {}),
      ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
    },
    cameraMove: { move: shot.cameraMove, speed: shot.cameraSpeed },
    ...(beats.length > 0 ? { beats } : {}),
  };
}

export async function extractFromVideo(
  gateway: Gateway,
  frames: ImagePart[],
  options: ShotOptions,
): Promise<ShotResult> {
  if (frames.length === 0) {
    throw new Error('No frames to read: the video produced nothing to look at.');
  }

  const result = await gateway.extract({
    system: SHOT_SYSTEM,
    // The duration goes in the question rather than the schema: it is known,
    // and asking a model to guess something already measured invites a wrong
    // answer that then has to be corrected.
    instruction: withNote(
      options.durationS === undefined
        ? SHOT_INSTRUCTION
        : `${SHOT_INSTRUCTION} The clip runs ${options.durationS.toFixed(1)} seconds.`,
      options.note,
    ),
    images: frames,
    schema: ExtractedShot,
    schemaVersion: SHOT_VERSION,
  });

  return {
    ir: shotToIR(result.value, options),
    shot: result.value,
    usage: result.usage,
    cached: result.cached,
    key: result.key,
  };
}
