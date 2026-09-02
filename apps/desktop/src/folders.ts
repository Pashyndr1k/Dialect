/**
 * Opening the folder a thing lives in.
 *
 * Was five copies of the same three lines, each ending in
 * `.catch(() => undefined)` — and every one of them was failing. `opener:default`
 * grants open-url and reveal-item, not open-path, so the call was refused every
 * time and the swallow made a button that did nothing and said nothing.
 *
 * Two lessons, both taken: the permission is now asked for explicitly, and
 * nothing here swallows. A folder that will not open says so.
 */

import { invoke } from '@tauri-apps/api/core';

const hasHost = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The kinds the host keeps folders for. */
export type Kept = 'templates' | 'sources' | 'graphs';

/**
 * Show a kept folder in the file manager.
 *
 * Throws rather than returning quietly: the caller has somewhere to put the
 * reason, and "nothing happened" is the one outcome that teaches people the
 * button is broken without telling them why.
 */
export async function openKeptFolder(what: Kept): Promise<string> {
  if (!hasHost()) {
    throw new Error('Opening a folder needs the desktop app; a browser cannot reach the disk.');
  }

  const dir = await invoke<string>('authored_folder', { what });
  const { openPath } = await import('@tauri-apps/plugin-opener');
  await openPath(dir);
  return dir;
}

/** Same, for a folder the caller already knows the path of. */
export async function showFolder(dir: string): Promise<void> {
  if (!hasHost()) throw new Error('Opening a folder needs the desktop app.');
  const { openPath } = await import('@tauri-apps/plugin-opener');
  await openPath(dir);
}
