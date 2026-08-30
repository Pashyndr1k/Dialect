/**
 * Saved sources as files.
 *
 * The same argument as the templates: a character someone worked out and wants
 * to keep should be something they can open, fix a word in, copy to another
 * machine, or send to someone. YAML rather than JSON for exactly that reason —
 * the interesting part is a list of sentences, and sentences are what people
 * edit.
 */

import { parse as parseYaml, stringify as toYaml } from 'yaml';

import { SOURCE_ROLES, type BundleItem, type SourceRole } from '../compose/types.ts';
import { SourceError, type SavedSource } from './types.ts';

const KINDS = ['words', 'image', 'video', 'audio'] as const;

export function parseSource(text: string, source: string): SavedSource {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new SourceError(`${source} is not valid YAML: ${(err as Error).message}`);
  }
  if (raw === null || typeof raw !== 'object') {
    throw new SourceError(`${source} is empty or not a mapping.`);
  }

  const doc = raw as Record<string, unknown>;
  const missing = ['id', 'name', 'lines'].filter((k) => doc[k] === undefined);
  if (missing.length > 0) {
    throw new SourceError(`${source} is missing ${missing.join(', ')}.`);
  }

  const lines = Array.isArray(doc['lines'])
    ? doc['lines'].map((l) => String(l)).filter((l) => l.trim())
    : [];
  if (lines.length === 0) {
    throw new SourceError(`${source} says nothing: a source with no lines is not one.`);
  }

  // A role or kind this build does not know is not a reason to lose the source;
  // it falls back to something meaningful and the lines survive.
  const role = doc['role'] as SourceRole;
  const kind = doc['kind'] as SavedSource['kind'];

  return {
    id: String(doc['id']),
    name: String(doc['name']),
    kind: KINDS.includes(kind) ? kind : 'words',
    role: SOURCE_ROLES.includes(role) ? role : 'auto',
    lines,
    ...(doc['from'] ? { from: String(doc['from']) } : {}),
    savedAt: String(doc['savedAt'] ?? new Date().toISOString().slice(0, 10)),
    ...(doc['thumb'] ? { thumb: String(doc['thumb']) } : {}),
    ...(doc['about'] ? { about: String(doc['about']) } : {}),
  };
}

/**
 * A source as a file.
 *
 * The thumbnail goes last and on its own: it is a data URL thousands of
 * characters long, and anything after it would never be read by a person
 * scrolling the file.
 */
export function sourceToYaml(source: SavedSource): string {
  const { thumb, ...rest } = source;
  const ordered: Record<string, unknown> = {
    id: rest.id,
    name: rest.name,
    kind: rest.kind,
    role: rest.role,
    ...(rest.about ? { about: rest.about } : {}),
    ...(rest.from ? { from: rest.from } : {}),
    savedAt: rest.savedAt,
    lines: rest.lines,
  };

  const body = toYaml(ordered, { lineWidth: 0 });
  return thumb ? `${body}${toYaml({ thumb }, { lineWidth: 0 })}` : body;
}

/** What the composer takes: a saved source is a bundle item that cost nothing. */
export const asBundleItem = (source: SavedSource): BundleItem => ({
  id: source.id,
  kind: source.kind,
  role: source.role,
  lines: source.lines,
});

/** Newest first, because the one just kept is the one being looked for. */
export const sortSources = (sources: SavedSource[]): SavedSource[] =>
  [...sources].sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.name.localeCompare(b.name));
