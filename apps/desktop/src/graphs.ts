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

/* -------------------------------------------------------- somewhere else --- */

/**
 * Where the app keeps graphs, for saying out loud.
 *
 * People ask where their files are, and "in the app's data folder" is not an
 * answer anyone can act on.
 */
export async function graphsFolder(): Promise<string> {
  if (!hasHost()) return '(in this browser, not on disk)';
  return invoke<string>('authored_folder', { what: 'graphs' });
}

/**
 * Save this graph wherever the person says, through the system dialog.
 *
 * Separate from `saveGraph`, which files things under a name in the app's own
 * folder. Both are worth having: one is a library, the other is a file you can
 * put next to the project it belongs to and send to somebody.
 *
 * Returns the path written, or null if the dialog was dismissed — cancelling is
 * not a failure and must not be reported as one.
 */
export async function saveGraphAs(doc: GraphDoc): Promise<string | null> {
  if (!hasHost()) throw new Error('Saving to a folder needs the desktop app.');

  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    title: 'Save this graph',
    defaultPath: `${idFor(doc.name ?? 'graph')}.json`,
    filters: [{ name: 'Dialect graph', extensions: ['json'] }],
  });
  if (!path) return null;

  await invoke<void>('file_write', { path, text: `${JSON.stringify(doc, null, 2)}
` });
  return path;
}

/** Open a graph from anywhere on disk. Null when the dialog was dismissed. */
export async function openGraphFile(): Promise<{ doc: GraphDoc; path: string } | null> {
  if (!hasHost()) throw new Error('Opening a file needs the desktop app.');

  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    title: 'Open a graph',
    multiple: false,
    filters: [{ name: 'Dialect graph', extensions: ['json'] }],
  });
  const path = typeof picked === 'string' ? picked : null;
  if (!path) return null;

  const text = await invoke<string>('file_text', { path });
  const doc = JSON.parse(text) as GraphDoc;
  // Said here rather than three screens later, when a node fails to appear.
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) {
    throw new Error(`${path.split(/[\/]/).pop()} is not a Dialect graph.`);
  }
  return { doc, path };
}
