/**
 * Node-only glue for reading profile cards off disk.
 *
 * Kept apart from `load.ts` so the compiler itself stays portable — a browser
 * build inlines the same YAML through `parseRegistry` instead.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Registry } from './types.ts';
import { parseRegistry } from './load.ts';

/** The profiles shipped with this build. */
export const BUILTIN_MODELS_DIR = fileURLToPath(new URL('./models/', import.meta.url));

export async function loadRegistryFromDir(dir: string): Promise<Registry> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'));
  const entries = await Promise.all(
    names.sort().map(async (name) => ({
      source: name,
      text: await readFile(join(dir, name), 'utf8'),
    })),
  );
  return parseRegistry(entries);
}

export function loadBuiltinRegistry(): Promise<Registry> {
  return loadRegistryFromDir(BUILTIN_MODELS_DIR);
}
