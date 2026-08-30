/**
 * Compiling a whole sequence.
 *
 * Every shot goes through the ordinary compiler — a sequence gets no special
 * treatment and no second code path, which is the only way the prompt for shot
 * three can be trusted to be as good as the prompt for a shot on its own.
 * What the sequence adds is the joins between them.
 */

import { compile, type CompileOptions, type CompileResult } from '../compile.ts';
import type { ModelProfile } from '../registry/types.ts';
import type { Finding } from '../rules/types.ts';
import { toDocument } from '../renderers/document.ts';
import { expandShot, sequenceRuntimeS } from './expand.ts';
import { checkSequence } from './continuity.ts';
import type { Sequence } from './types.ts';

export interface CompiledShot extends CompileResult {
  id: string;
  index: number;
}

export interface CompiledSequence {
  shots: CompiledShot[];
  /** Findings about the joins. Per-shot findings stay on their shot. */
  continuity: Finding[];
  runtimeS: number;
  /** True if any shot would not survive generation. */
  blocked: boolean;
}

export function compileSequence(
  sequence: Sequence,
  profile: ModelProfile,
  options: CompileOptions = {},
): CompiledSequence {
  const shots = sequence.shots.map((shot, index) => ({
    ...compile(expandShot(sequence, index), profile, { ...options, throwOnBlock: false }),
    id: shot.id,
    index,
  }));

  return {
    shots,
    continuity: checkSequence(sequence),
    runtimeS: sequenceRuntimeS(sequence),
    blocked: shots.some((s) => s.blocked),
  };
}

/**
 * The sequence as one file.
 *
 * Shots stay separated by a rule the eye can find, because this is read while
 * copying one prompt at a time into somewhere else.
 */
export function sequenceToDocument(
  sequence: Sequence,
  profile: ModelProfile,
  compiled = compileSequence(sequence, profile),
): string {
  const runtime = compiled.runtimeS > 0 ? `, ${compiled.runtimeS}s total` : '';
  const head = [
    `${sequence.title ?? 'Sequence'} — ${compiled.shots.length} shots for ${profile.label}${runtime}`,
  ];

  if (compiled.continuity.length > 0) {
    head.push(
      ['Continuity:', ...compiled.continuity.map((f) => `- ${f.message} ${f.fix ?? ''}`.trimEnd())].join(
        '\n',
      ),
    );
  }

  const bodies = compiled.shots.map((shot) => {
    const source = sequence.shots[shot.index];
    const start = source?.continuesFromFrame ? ' · starts from the previous frame' : '';
    return [
      `${'-'.repeat(60)}\n${shot.id.toUpperCase()}${start}`,
      toDocument(shot.render, profile),
    ].join('\n\n');
  });

  return [...head, ...bodies].join('\n\n') + '\n';
}
