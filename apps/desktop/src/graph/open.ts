/**
 * The graphs that were open when the window closed.
 *
 * Distinct from a saved graph: these are not things anyone chose to keep, they
 * are where they were. Losing them on a restart would be worse than any missing
 * feature, and asking someone to remember to save first is asking them to do
 * the computer's job.
 *
 * One file per tab, under reserved ids in the same folder as the saved ones, so
 * they are files like the others and can be opened by hand when something goes
 * wrong. The ids sort first and read as what they are; the saved list hides
 * them.
 */

import type { GraphDoc } from '@dialect/core';

import { deleteGraph, listGraphs, saveGraph } from '../graphs.ts';

/** Reserved. `0-open` is the first tab, `0-open-2` the second, and so on. */
export const OPEN_PREFIX = '0-open';

export const openIdFor = (index: number): string =>
  index === 0 ? OPEN_PREFIX : `${OPEN_PREFIX}-${index + 1}`;

/** Whether an id belongs to an open tab rather than to something kept. */
export const isOpenId = (id: string): boolean =>
  id === OPEN_PREFIX || id.startsWith(`${OPEN_PREFIX}-`);

/** Which tab an open id is, so they come back in the order they were left. */
function indexOf(id: string): number {
  if (id === OPEN_PREFIX) return 0;
  const n = Number.parseInt(id.slice(OPEN_PREFIX.length + 1), 10);
  return Number.isFinite(n) ? n - 1 : 0;
}

let pending: ReturnType<typeof setTimeout> | undefined;
let latest: GraphDoc[] | undefined;

/**
 * How many tab files are on disk, so closing a tab can remove its file.
 *
 * Seeded by the load rather than starting at zero. Starting at zero meant that
 * closing a tab before the first write left its file behind — nothing knew it
 * was there to delete — and it came back at the next start, which is a closed
 * tab reopening itself.
 */
let onDisk = 0;

/** Every tab that was open, in order. Empty on a first run. */
export async function loadOpenTabs(): Promise<GraphDoc[]> {
  try {
    const found = (await listGraphs())
      .filter((g) => isOpenId(g.id))
      .sort((a, b) => indexOf(a.id) - indexOf(b.id));
    onDisk = found.length;
    return found.map((g) => g.doc);
  } catch {
    return [];
  }
}

/**
 * Remember where we are, debounced.
 *
 * Every keystroke in a Words node changes a graph, so writing on each one would
 * be a file write per character — and now a file write per character per open
 * tab, which is worth the delay rather than the disk.
 */
export function rememberOpenTabs(docs: GraphDoc[]): void {
  latest = docs;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = undefined;
    void write();
  }, 1000);
}

async function write(): Promise<void> {
  const docs = latest;
  if (!docs) return;

  try {
    await Promise.all(docs.map((doc, i) => saveGraph(openIdFor(i), doc)));

    // Closing a tab has to remove its file as well, or the next start reopens
    // a tab that was deliberately shut.
    for (let i = docs.length; i < onDisk; i += 1) {
      await deleteGraph(openIdFor(i)).catch(() => undefined);
    }
    onDisk = docs.length;
  } catch {
    // Where we are is not worth interrupting anyone over. The work itself is
    // untouched, and the next change tries again a second later.
  }
}

/**
 * Write immediately rather than in a second's time.
 *
 * Closing a tab is the one change that must not wait: a debounce that has not
 * fired when the window goes away leaves the closed tab's file on disk, and it
 * comes back on the next start.
 */
export async function rememberOpenTabsNow(docs: GraphDoc[]): Promise<void> {
  latest = docs;
  if (pending) clearTimeout(pending);
  pending = undefined;
  await write();
}
