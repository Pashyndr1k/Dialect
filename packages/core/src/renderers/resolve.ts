/**
 * Resolving a field spec into text.
 *
 * A field-list dialect is described by data: each field names the IR paths that
 * feed it and how to join them. That is deliberately a list of paths and a
 * separator, not a template language — the moment it grows conditionals and
 * loops it stops being editable by anyone who is not a programmer, which was
 * the whole point of moving it out of code.
 *
 * The one concession is a small, fixed vocabulary of computed values, written
 * with a leading `@`. They exist because a couple of lines in a prompt are
 * phrases rather than fields — "slow push-in" is two IR values and a word order
 * that only makes sense together.
 */

import { getPath } from '../ir/paths.ts';
import type { PromptIR } from '../ir/types.ts';
import type { ModelProfile } from '../registry/types.ts';

export interface FieldSpec {
  /** Dialect field name, e.g. `Subject`. */
  name: string;
  /** IR paths, in the order they should read. `[]` means each item of an array. */
  from: string[];
  /** Separator between the parts that survive. Defaults to `, `. */
  join?: string;
  /**
   * `join` (the default) concatenates every source. `first` takes the first
   * source that yields anything — the way a headline falls back to the names
   * of whatever is in frame.
   */
  mode?: 'join' | 'first';
  /** Used when nothing resolves — a deliberate minimal value beats an omission. */
  fallback?: string;
  /** `negative` travels beside the prompt rather than inside it. */
  role?: 'negative';
}

type Computed = (ir: PromptIR, profile: ModelProfile) => string | undefined;

/** Moves read hyphenated in cinematography: push-in, dolly-zoom, whip-pan. */
function cameraMove(ir: PromptIR): string | undefined {
  const cm = ir.cameraMove;
  if (!cm) return undefined;
  return cm.speed && cm.speed !== 'medium' ? `${cm.speed} ${cm.move}` : cm.move;
}

/** Emitted only where the profile says the model reads gear numbers at all. */
function lens(ir: PromptIR, profile: ModelProfile): string | undefined {
  if (!profile.supports?.emitsGearNumbers) return undefined;
  const hint = ir.optics?.gearHint;
  if (!hint) return undefined;
  return /lens$/i.test(hint) ? hint : `${hint} lens`;
}

export const COMPUTED: Record<string, Computed> = {
  '@cameraMove': cameraMove,
  '@lens': lens,
};

export class FieldSpecError extends Error {
  constructor(profileId: string, field: string, detail: string) {
    super(`Field "${field}" of profile "${profileId}" ${detail}`);
    this.name = 'FieldSpecError';
  }
}

function expand(ir: PromptIR, path: string): string[] {
  const at = path.indexOf('[]');
  if (at !== -1) {
    const prefix = path.slice(0, at);
    const rest = path.slice(at + 2);
    const array = getPath(ir, prefix);
    if (!Array.isArray(array)) return [];
    return array.flatMap((_, i) => expand(ir, `${prefix}[${i}]${rest}`));
  }

  const value = getPath(ir, path);
  if (typeof value === 'string') return [path];
  if (typeof value === 'number' || typeof value === 'boolean') return [path];
  return [];
}

/** The strings one field draws from the IR, before they are joined. */
export function partsFor(ir: PromptIR, spec: FieldSpec, profile: ModelProfile): string[] {
  const out: string[] = [];

  for (const source of spec.from) {
    // In `first` mode a source that produced something ends the search.
    if (spec.mode === 'first' && out.length > 0) break;

    if (source.startsWith('@')) {
      const compute = COMPUTED[source];
      if (!compute) {
        throw new FieldSpecError(
          profile.id,
          spec.name,
          `asks for "${source}", which is not a computed value this build knows. ` +
            `Known: ${Object.keys(COMPUTED).join(', ')}.`,
        );
      }
      const value = compute(ir, profile);
      if (value?.trim()) out.push(value.trim());
      continue;
    }

    for (const path of expand(ir, source)) {
      const value = getPath(ir, path);
      const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
      if (text) out.push(text);
    }
  }

  return out;
}

export function resolveField(ir: PromptIR, spec: FieldSpec, profile: ModelProfile): string {
  const text = partsFor(ir, spec, profile).join(spec.join ?? ', ');
  return text || (spec.fallback ?? '');
}
