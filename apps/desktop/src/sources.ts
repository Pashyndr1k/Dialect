import { invoke } from '@tauri-apps/api/core';
import {
  parseSource,
  sortSources,
  sourceToYaml,
  type SavedSource,
} from '@dialect/core';

import { openKeptFolder } from './folders.ts';

/**
 * Sources someone kept, as files the host holds.
 *
 * The same arrangement as the templates, and now literally the same commands:
 * a folder of YAML, read and written by the host, parsed here because what a
 * source means belongs on this side.
 */

const hasHost = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Kept in memory without a host, so the browser preview still behaves. */
let inMemory: SavedSource[] = [];

export async function listSources(): Promise<SavedSource[]> {
  if (!hasHost()) return sortSources(inMemory);

  const stored = await invoke<Array<{ id: string; text: string }>>('authored_list', {
    what: 'sources',
  });

  return sortSources(
    stored.flatMap((file) => {
      try {
        return [parseSource(file.text, `${file.id}.yaml`)];
      } catch {
        // One unreadable file must not hide the rest; it stays on disk to be
        // fixed by hand.
        return [];
      }
    }),
  );
}

export async function saveSource(source: SavedSource): Promise<void> {
  if (!hasHost()) {
    inMemory = [...inMemory.filter((s) => s.id !== source.id), source];
    return;
  }
  await invoke<string>('authored_save', {
    what: 'sources',
    id: source.id,
    text: sourceToYaml(source),
  });
}

export async function deleteSource(id: string): Promise<void> {
  if (!hasHost()) {
    inMemory = inMemory.filter((s) => s.id !== id);
    return;
  }
  await invoke<void>('authored_delete', { what: 'sources', id });
}

export async function openSourcesFolder(): Promise<void> {
  await openKeptFolder('sources');
}
