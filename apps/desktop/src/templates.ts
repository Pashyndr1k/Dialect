import { invoke } from '@tauri-apps/api/core';
import {
  createLibrary,
  parseLibrary,
  parseTemplate,
  type Library,
  type Template,
} from '@dialect/core';

import { openKeptFolder } from './folders.ts';

/**
 * Templates: the ones that ship, and the ones someone made.
 *
 * The built-in ones are read out of the core package at build time — the same
 * arrangement as the model cards, so the window keeps no Node dependency and
 * the browser preview behaves exactly like the packaged app. The custom ones
 * are files the host keeps, parsed by the same parser, because a template
 * someone made must not be able to mean something a shipped one cannot.
 */
const read = (glob: Record<string, string>) =>
  Object.entries(glob).map(([path, text]) => ({
    source: path.slice(path.lastIndexOf('/') + 1),
    text,
  }));

// The options have to be written out at each call: Vite reads this glob at
// build time and will not follow a variable to find them.
export const builtinLibrary: Library = parseLibrary(
  read(
    import.meta.glob('../../../packages/core/src/templates/builtin/templates/*.yaml', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ),
  read(
    import.meta.glob('../../../packages/core/src/templates/builtin/snippets/*.yaml', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ),
);

const hasHost = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Kept in memory when there is no host, so the browser preview still works. */
let inMemory: Template[] = [];

export async function listTemplates(): Promise<Template[]> {
  if (!hasHost()) return inMemory;

  const stored = await invoke<Array<{ id: string; text: string }>>('authored_list', {
    what: 'templates',
  });
  return stored.flatMap((file) => {
    try {
      return [parseTemplate(file.text, `${file.id}.yaml`)];
    } catch {
      // One unreadable file must not hide the rest; it stays on disk to be
      // fixed by hand.
      return [];
    }
  });
}

export async function saveTemplate(id: string, text: string): Promise<void> {
  if (!hasHost()) {
    inMemory = [...inMemory.filter((t) => t.id !== id), parseTemplate(text, `${id}.yaml`)];
    return;
  }
  await invoke<string>('authored_save', { what: 'templates', id, text });
}

export async function deleteTemplate(id: string): Promise<void> {
  if (!hasHost()) {
    inMemory = inMemory.filter((t) => t.id !== id);
    return;
  }
  await invoke<void>('authored_delete', { what: 'templates', id });
}

export async function openTemplatesFolder(): Promise<void> {
  await openKeptFolder('templates');
}

/**
 * The built-in templates plus the custom ones.
 *
 * A custom template wins an id clash, because someone who names theirs after a
 * shipped one meant to replace it.
 */
export function libraryWith(custom: Template[]): Library {
  const templates = new Map(builtinLibrary.templates);
  for (const template of custom) templates.set(template.id, template);

  return createLibrary([...templates.values()], [...builtinLibrary.snippets.values()]);
}

/**
 * Every template, ordered by what it makes and then by name.
 *
 * Not filtered to a chosen target: picking a template is picking what to make,
 * and the target follows from it rather than the other way round.
 */
export const allTemplates = (library: Library): Template[] =>
  [...library.templates.values()].sort(
    (a, b) => a.modality.localeCompare(b.modality) || a.name.localeCompare(b.name),
  );
