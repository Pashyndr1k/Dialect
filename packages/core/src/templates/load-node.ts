/**
 * Node-only glue for reading templates and snippets off disk.
 *
 * Kept apart from `library.ts` so the compiler stays portable — a browser build
 * inlines the same YAML through `parseLibrary` instead.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLibrary, type SourceFile } from './library.ts';
import type { Library } from './types.ts';

export const BUILTIN_DIR = fileURLToPath(new URL('./builtin/', import.meta.url));

async function read(dir: string): Promise<SourceFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'));
  return Promise.all(
    names.sort().map(async (name) => ({ source: name, text: await readFile(join(dir, name), 'utf8') })),
  );
}

export async function loadLibraryFromDir(dir: string): Promise<Library> {
  return parseLibrary(await read(join(dir, 'templates')), await read(join(dir, 'snippets')));
}

export const loadBuiltinLibrary = (): Promise<Library> => loadLibraryFromDir(BUILTIN_DIR);
