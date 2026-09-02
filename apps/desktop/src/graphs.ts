/**
 * Graphs, as files the host holds.
 *
 * The same arrangement as the templates and the kept sources, and for the same
 * reason: a graph someone built is theirs, so it lives in a folder they can
 * open, copy, and send to somebody. The difference is the format — JSON rather
 * than YAML, because a graph is made by dragging rather than by typing and has
 * to come back exactly as it went in.
 */

import { invoke } from '@tauri-apps/api/core';
import type { GraphDoc } from '@dialect/core';
import { openKeptFolder } from './folders.ts';

const hasHost = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Kept in memory without a host, so the browser preview still behaves. */
let inMemory = new Map<string, GraphDoc>();

export interface SavedGraph {
  id: string;
  doc: GraphDoc;
}

/**
 * A name someone typed, as a file name.
 *
 * The host refuses anything that is not one, so this does the flattening here
 * rather than handing back an error about characters nobody typed on purpose.
 */
export const idFor = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'graph';

function parse(id: string, text: string): SavedGraph | null {
  try {
    const doc = JSON.parse(text) as GraphDoc;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.nodes)) return null;
    return { id, doc };
  } catch {
    return null;
  }
}

export async function listGraphs(): Promise<SavedGraph[]> {
  if (!hasHost()) return [...inMemory].map(([id, doc]) => ({ id, doc }));

  const stored = await invoke<Array<{ id: string; text: string }>>('authored_list', {
    what: 'graphs',
  });

  // One unreadable file must not hide the rest; it stays on disk to be fixed
  // by hand, which is the point of keeping these as files.
  return stored.flatMap((file) => parse(file.id, file.text) ?? []);
}

export async function saveGraph(id: string, doc: GraphDoc): Promise<void> {
  if (!hasHost()) {
    inMemory.set(id, doc);
    return;
  }
  await invoke<string>('authored_save', {
    what: 'graphs',
    id,
    text: `${JSON.stringify(doc, null, 2)}\n`,
  });
}

export async function deleteGraph(id: string): Promise<void> {
  if (!hasHost()) {
    inMemory.delete(id);
    return;
  }
  await invoke<void>('authored_delete', { what: 'graphs', id });
}

export async function openGraphsFolder(): Promise<void> {
  await openKeptFolder('graphs');
}
