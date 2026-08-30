/**
 * What can go wrong between two shots.
 *
 * The engine rules look at one document. These look at the joins, which is
 * where a sequence actually fails: not because any single prompt is wrong, but
 * because shot three quietly describes a different man than shot two, or cuts
 * to a place shot two never left.
 *
 * They are findings rather than rules for one reason — a rule takes an IR, and
 * none of this is visible in one.
 */

import type { Entity } from '../ir/types.ts';
import type { Finding } from '../rules/types.ts';
import type { Sequence, SequenceShot } from './types.ts';

/** How many shots in a row may share a camera move before it reads as a stall. */
const MONOTONY_RUN = 3;

/**
 * What a shot actually renders as, not what it stores.
 *
 * A shot that names no move inherits the world's, and the prompt says so — so a
 * check reading only the shot's own field would miss four identical push-ins
 * and flag nothing.
 */
const effectiveMove = (sequence: Sequence, i: number): string | undefined =>
  sequence.shots[i]?.cameraMove?.move ?? sequence.world.cameraMove?.move;

const effectiveSize = (sequence: Sequence, i: number): string | undefined =>
  sequence.shots[i]?.shot?.size ?? sequence.world.shot?.size;

const effectiveAngle = (sequence: Sequence, i: number): string =>
  sequence.shots[i]?.shot?.angle ?? sequence.world.shot?.angle ?? '';

const at = (i: number, field?: string): string =>
  `shots[${i}]${field ? `.${field}` : ''}`;

const overrideEntities = (shot: SequenceShot): Entity[] => {
  const subject = shot.overrides?.['subject'];
  if (typeof subject !== 'object' || subject === null) return [];
  const entities = (subject as Record<string, unknown>)['entities'];
  return Array.isArray(entities) ? (entities as Entity[]) : [];
};

const overrideLocation = (shot: SequenceShot): string | undefined => {
  const environment = shot.overrides?.['environment'];
  if (typeof environment !== 'object' || environment === null) return undefined;
  const location = (environment as Record<string, unknown>)['location'];
  return typeof location === 'string' ? location : undefined;
};

/**
 * Everything wrong with the joins, in shot order.
 *
 * Nothing here blocks. A sequence with a jump cut in it still compiles, and
 * sometimes a jump cut is the point — these say what an editor would say, and
 * leave the decision where it belongs.
 */
export function checkSequence(sequence: Sequence): Finding[] {
  const findings: Finding[] = [];
  const worldEntities = new Map(
    (sequence.world.subject?.entities ?? []).map((e) => [e.id, e]),
  );

  sequence.shots.forEach((shot, i) => {
    const previous = i > 0 ? sequence.shots[i - 1] : undefined;

    // A character described twice is a character generated twice.
    for (const entity of overrideEntities(shot)) {
      const known = worldEntities.get(entity.id);
      if (known?.description && entity.description && known.description !== entity.description) {
        findings.push({
          ruleId: 'seq-cast-drift',
          level: 'warn',
          message: `${shot.id} describes ${known.name} differently from the rest of the sequence.`,
          fix: 'Change the description once, in the world, so every shot generates the same person.',
          path: at(i, 'overrides.subject.entities'),
        });
      }
    }

    const moved = overrideLocation(shot);
    if (moved && previous && shot.seam !== 'portal' && shot.seam !== 'hard-cut') {
      findings.push({
        ruleId: 'seq-location-drift',
        level: 'warn',
        message: `${shot.id} moves to ${moved} without cutting there.`,
        fix: 'Set the seam to a hard cut or a portal, or keep the shot where it was.',
        path: at(i, 'overrides.environment.location'),
      });
    }

    if (shot.seam === 'frozen-handoff' && !shot.continuesFromFrame) {
      findings.push({
        ruleId: 'seq-handoff-needs-a-frame',
        level: 'warn',
        message: `${shot.id} joins on a frozen hand-off but does not start from the previous frame.`,
        fix: 'Turn on "continues from frame", or pick a seam that does not promise one.',
        path: at(i, 'seam'),
      });
    }

    if (!previous && (shot.seam || shot.continuesFromFrame)) {
      findings.push({
        ruleId: 'seq-first-shot-has-a-seam',
        level: 'warn',
        message: 'The first shot joins onto nothing.',
        fix: 'Clear its seam; it is where the sequence starts.',
        path: at(i, 'seam'),
      });
    }

    // Two shots at the same size and angle on the same subject read as a
    // glitch rather than a cut — the reason editors change one or the other.
    const size = effectiveSize(sequence, i);
    if (
      previous &&
      !overrideLocation(shot) &&
      size &&
      size === effectiveSize(sequence, i - 1) &&
      effectiveAngle(sequence, i) === effectiveAngle(sequence, i - 1)
    ) {
      findings.push({
        ruleId: 'seq-jump-cut',
        level: 'warn',
        message: `${previous.id} and ${shot.id} are the same size from the same angle.`,
        fix: 'Change the shot size or move the camera round; otherwise the cut reads as a skip.',
        path: at(i, 'shot.size'),
      });
    }
  });

  // A run of identical moves, counted once rather than flagged on every shot.
  let run = 1;
  for (let i = 1; i <= sequence.shots.length; i += 1) {
    const move = i < sequence.shots.length ? effectiveMove(sequence, i) : undefined;
    const before = effectiveMove(sequence, i - 1);

    if (move && move === before) {
      run += 1;
      continue;
    }
    if (run >= MONOTONY_RUN && before) {
      findings.push({
        ruleId: 'seq-camera-monotony',
        level: 'warn',
        message: `${run} shots in a row are a ${before}.`,
        fix: 'Let one of them hold still. A move means less when every shot has the same one.',
        path: at(i - run, 'cameraMove.move'),
      });
    }
    run = 1;
  }

  return findings;
}
