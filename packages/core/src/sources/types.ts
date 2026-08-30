/**
 * A source worth keeping.
 *
 * The plan called for two things — entity cards, so a character survives from
 * one prompt to the next, and a style DNA, so a look does. The bundle turned
 * them into the same object: a cast member and a look are both a named source
 * with a job, and the only difference is which job.
 *
 * What makes this worth building rather than merely tidy is the two-pass split.
 * A reading is bought once and is text afterwards, so a character read from one
 * photograph can appear in fifty prompts without the photograph being looked at
 * again. Keeping the lines keeps the whole of what was paid for.
 */

import type { SourceKind, SourceRole } from '../compose/types.ts';

export const SOURCES_VERSION = 1 as const;

export interface SavedSource {
  /** File-name-safe, and the id the app attaches by. */
  id: string;
  /** What to call it in a list. */
  name: string;
  kind: SourceKind;
  /** What it is for. Saved with it, because that is half of what it is. */
  role: SourceRole;
  /** What it says. The whole of what the reading cost. */
  lines: string[];
  /** What it was read from, so its origin is not lost. */
  from?: string;
  /** ISO date. */
  savedAt: string;
  /** A small JPEG data URL, so it can be recognised on sight. */
  thumb?: string;
  /** Free note for the person, never sent anywhere. */
  about?: string;
}

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

/** `The Cowboy` becomes `the-cowboy`, uniquely. */
export function sourceId(name: string, taken: Iterable<string> = []): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'source';

  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}
