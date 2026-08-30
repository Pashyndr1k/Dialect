/**
 * Node-only glue for reading decks off disk. Kept apart so the compiler stays
 * portable — a browser build inlines the same YAML through `parseDecks`.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDecks } from './load.ts';
import type { Deck } from './types.ts';

export const BUILTIN_DECKS_DIR = fileURLToPath(new URL('./builtin/', import.meta.url));

export async function loadDecksFromDir(dir: string): Promise<Deck[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'));
  return parseDecks(
    await Promise.all(
      names.sort().map(async (source) => ({ source, text: await readFile(join(dir, source), 'utf8') })),
    ),
  );
}

export const loadBuiltinDecks = (): Promise<Deck[]> => loadDecksFromDir(BUILTIN_DECKS_DIR);
