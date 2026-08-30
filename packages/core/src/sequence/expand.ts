/**
 * Turning one shot of a sequence back into a whole document.
 *
 * Expansion is deliberately dumb: copy the world, lay the shot's differences on
 * top, and hand the result to the same compiler everything else uses. A shot
 * that has been expanded is indistinguishable from a document written by hand,
 * which is why nothing downstream needs to know sequences exist.
 */

import { IR_VERSION, type PromptIR } from '../ir/types.ts';
import { mergeFragments } from '../templates/apply.ts';
import { SEQUENCE_VERSION, type Sequence, type SequenceShot } from './types.ts';

/**
 * What a start frame already establishes, and therefore what a continuation
 * prompt must stop describing.
 *
 * The picture fixes the room and the light better than any sentence can, so
 * restating them can only disagree with it — and a disagreement at the seam is
 * exactly where the join becomes visible. Identity is not on this list: the
 * model has to *track* a person through motion, not merely render them once,
 * and the repeated description is what keeps them the same person.
 */
export const CARRIED_BY_A_START_FRAME = [
  'environment.description',
  'environment.layers',
  'environment.weather',
  'lighting',
  'optics',
  'texture',
  'palette',
  'style.notes',
] as const;

function dropPath(ir: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  const last = parts.pop();
  if (!last) return;

  let cursor: Record<string, unknown> | undefined = ir;
  for (const part of parts) {
    const next: unknown = cursor?.[part];
    cursor = typeof next === 'object' && next !== null ? (next as Record<string, unknown>) : undefined;
    if (!cursor) return;
  }
  delete cursor[last];
}

/** Where a continuation's start frame comes from, for the pipeline to resolve. */
export const lastFrameOf = (shotId: string): string => `shot:${shotId}#last`;

export function shotIndex(sequence: Sequence, id: string): number {
  return sequence.shots.findIndex((s) => s.id === id);
}

/**
 * The whole document for one shot.
 *
 * `index` rather than an id, because a shot's meaning depends on the one before
 * it — a seam is a relationship, not a property.
 */
export function expandShot(sequence: Sequence, index: number): PromptIR {
  const shot = sequence.shots[index];
  if (!shot) throw new RangeError(`This sequence has no shot ${index}.`);

  const previous = index > 0 ? sequence.shots[index - 1] : undefined;

  const world = structuredClone(sequence.world) as unknown as Record<string, unknown>;

  // Stripping happens to the world, before the shot's own differences go on
  // top. A field someone deliberately changed is the one thing the start frame
  // cannot show — it is what happens next — so it must survive.
  if (shot.continuesFromFrame && previous) {
    for (const path of CARRIED_BY_A_START_FRAME) dropPath(world, path);
  }

  const merged = mergeFragments(world, shot.overrides ?? {}) as unknown as PromptIR;

  const ir: PromptIR = {
    ...merged,
    irVersion: IR_VERSION,
    ...(sequence.title ? { title: `${sequence.title} — ${shot.id}` } : {}),
    subject: {
      ...merged.subject,
      ...(shot.action ? { action: shot.action } : {}),
    },
    ...(shot.shot || merged.shot ? { shot: { ...merged.shot, ...shot.shot } } : {}),
    ...(shot.cameraMove ? { cameraMove: shot.cameraMove } : {}),
    ...(shot.beats && shot.beats.length > 0 ? { beats: shot.beats } : {}),
  };

  if (previous) {
    ir.continuity = {
      ...merged.continuity,
      prevShot: previous.id,
      ...(shot.seam ? { seamIn: shot.seam } : {}),
      ...(shot.reestablish ? { reestablish: shot.reestablish } : {}),
    };
  }

  if (shot.continuesFromFrame && previous) {
    ir.frames = { ...merged.frames, start: lastFrameOf(previous.id) };
  }

  return ir;
}

/** Every shot, expanded, in order. */
export const expandSequence = (sequence: Sequence): PromptIR[] =>
  sequence.shots.map((_, i) => expandShot(sequence, i));

/** Total runtime, for the sequence header. Shots without a duration count zero. */
export const sequenceRuntimeS = (sequence: Sequence): number =>
  Math.round(
    sequence.shots.reduce(
      (total, s) => total + (s.shot?.durationS ?? sequence.world.shot?.durationS ?? 0),
      0,
    ) * 10,
  ) / 10;

/** The next free `s<n>`, so ids stay readable and stable after a deletion. */
export function nextShotId(sequence: Sequence): string {
  const used = new Set(sequence.shots.map((s) => s.id));
  for (let n = 1; ; n += 1) {
    const id = `s${n}`;
    if (!used.has(id)) return id;
  }
}

/**
 * Seed a sequence from a document that was written or extracted on its own.
 *
 * Whatever the document said about this moment — its action, its move, its
 * beats — becomes shot one. What is left is the world, and it is left in place
 * rather than stripped: the per-shot fields are overridden on expansion, so a
 * stale action in the world can never reach a prompt.
 */
export function sequenceFromIR(ir: PromptIR, title?: string): Sequence {
  return {
    seqVersion: SEQUENCE_VERSION,
    ...(title ?? ir.title ? { title: title ?? ir.title } : {}),
    world: { ...ir, modality: ir.modality === 'audio' ? 'video' : ir.modality },
    shots: [
      {
        id: 's1',
        ...(ir.subject?.action ? { action: ir.subject.action } : {}),
        ...(ir.shot ? { shot: ir.shot } : {}),
        ...(ir.cameraMove ? { cameraMove: ir.cameraMove } : {}),
        ...(ir.beats ? { beats: ir.beats } : {}),
      },
    ],
  };
}

/**
 * Append a shot.
 *
 * It continues from the previous frame by default, because that is the join
 * that actually holds — and because the alternative, a hard cut, is a choice
 * someone should make on purpose rather than inherit.
 */
export function addShot(sequence: Sequence, shot: Partial<SequenceShot> = {}): Sequence {
  const previous = sequence.shots.at(-1);

  return {
    ...sequence,
    shots: [
      ...sequence.shots,
      {
        id: nextShotId(sequence),
        ...(previous ? { seam: 'frozen-handoff' as const, continuesFromFrame: true } : {}),
        ...shot,
      },
    ],
  };
}

export function updateShot(
  sequence: Sequence,
  id: string,
  change: Partial<SequenceShot>,
): Sequence {
  return {
    ...sequence,
    shots: sequence.shots.map((s) => (s.id === id ? { ...s, ...change } : s)),
  };
}

export function removeShot(sequence: Sequence, id: string): Sequence {
  return { ...sequence, shots: sequence.shots.filter((s) => s.id !== id) };
}
