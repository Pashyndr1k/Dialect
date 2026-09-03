/**
 * Opening the folder a thing lives in.
 *
 * Three attempts, and the first two both failed silently. It was five copies of
 * the same three lines, each ending in `.catch(() => undefined)`, calling a
 * plugin command that `opener:default` did not grant. Granting `open-path`
 * explicitly did not fix it either: that permission is documented as enabling
 * the command "without any pre-configured scope", and the plugin scope-checks
 * every path, so an empty allow-list denies all of them.
 *
 * So the host does it now — fifteen lines of `explorer`/`open`/`xdg-open`, with
 * tests. Nothing here swallows: a folder that will not open says why.
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
  await invoke<void>('show_folder', { path: dir });
  return dir;
}

/** Same, for a folder the caller already knows the path of. */
export async function showFolder(dir: string): Promise<void> {
  if (!hasHost()) throw new Error('Opening a folder needs the desktop app.');
  await invoke<void>('show_folder', { path: dir });
}
