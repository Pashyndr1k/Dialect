/**
 * A sequence: several shots that share one world.
 *
 * The reason this exists as its own shape rather than as a list of documents is
 * that everything which must not change between shots — who the character is,
 * what the room looks like, how it is lit — has to be stated *once*. Kept once,
 * it cannot drift. Kept four times, it will: someone edits shot two, forgets
 * shot three, and the model generates a different man in a different bar.
 *
 * So the world is one document and a shot is a small set of differences from
 * it. Expanding a shot repeats the world verbatim, which is exactly what holds
 * a character together across separate generations.
 */

import type { Beat, CameraMovement, PromptIR, Seam, Shot } from '../ir/types.ts';

export const SEQUENCE_VERSION = '1' as const;

/** The differences that make one shot in a sequence its own shot. */
export interface SequenceShot {
  id: string;
  /** One action. A second one is what the next shot is for. */
  action?: string;
  shot?: Shot;
  cameraMove?: CameraMovement;
  beats?: Beat[];

  /** How this shot joins the one before it. Meaningless on the first. */
  seam?: Seam;
  /**
   * Restated positions and facing directions across the cut. Without it
   * characters change sides of frame, which reads as a continuity error even
   * when everything else is right.
   */
  reestablish?: string;

  /**
   * The previous shot's last frame is fed in as this shot's start frame.
   *
   * That changes what the prompt should say: the frame already fixes the room
   * and the light, so repeating them can only introduce a mismatch at the seam.
   * Expansion drops those fields and keeps the ones the picture cannot carry —
   * who this is, and what they do next.
   */
  continuesFromFrame?: boolean;

  /** Anything else that genuinely differs — a light switched off, a new prop. */
  overrides?: Record<string, unknown>;

  /** Free note for the person, never rendered. */
  note?: string;
}

export interface Sequence {
  seqVersion: typeof SEQUENCE_VERSION;
  title?: string;
  /** The shared document. A full IR, so every part of the compiler still works. */
  world: PromptIR;
  shots: SequenceShot[];
}
