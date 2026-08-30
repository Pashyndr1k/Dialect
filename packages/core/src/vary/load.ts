import { parse as parseYaml } from 'yaml';
import type { Deck } from './types.ts';

/**
 * Decks as data, like the model cards and the templates.
 *
 * They came in as JSON asset libraries written for exactly this and are shipped
 * converted rather than parsed at every startup — one of them had a missing
 * comma, and a deck that cannot be read is a feature that quietly does nothing.
 */
export class DeckError extends Error {
  constructor(source: string, detail: string) {
    super(`Deck ${source} is not usable: ${detail}`);
    this.name = 'DeckError';
  }
}

export function parseDeck(text: string, source: string): Deck {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new DeckError(source, `it is not valid YAML (${(err as Error).message})`);
  }
  if (raw === null || typeof raw !== 'object') {
    throw new DeckError(source, 'it is empty or not a mapping');
  }

  const deck = raw as Partial<Deck>;
  const missing = (['id', 'name', 'axis', 'entries'] as const).filter((k) => deck[k] === undefined);
  if (missing.length > 0) throw new DeckError(source, `it is missing ${missing.join(', ')}`);

  const entries = (deck.entries ?? []).filter((e) => e?.id && e?.text?.trim());
  if (entries.length === 0) throw new DeckError(source, 'it has no usable entries');

  return { ...(deck as Deck), entries };
}

export const parseDecks = (files: Array<{ source: string; text: string }>): Deck[] =>
  files.map((f) => parseDeck(f.text, f.source)).sort((a, b) => a.name.localeCompare(b.name));
