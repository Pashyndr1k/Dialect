/**
 * The graph that was open when the window closed.
 *
 * Distinct from a saved graph: this is not something anyone chose to keep, it
 * is where they were. Losing it on a restart would be worse than any missing
 * feature, and asking someone to remember to save first is asking them to do
 * the computer's job.
 *
 * Kept under a reserved id in the same folder as the saved ones, so it is a
 * file like the others and can be opened by hand when something goes wrong.
 */

import type { GraphDoc } from '@dialect/core';

import { listGraphs, saveGraph } from '../graphs.ts';

/**
 * Reserved. Chosen to sort first and to read as what it is when someone opens
 * the folder; the editor hides it from the saved list.
 */
export const OPEN_ID = '0-open';

export async function loadOpenGraph(): Promise<GraphDoc | undefined> {
  try {
    return (await listGraphs()).find((g) => g.id === OPEN_ID)?.doc;
  } catch {
    return undefined;
  }
}

let pending: ReturnType<typeof setTimeout> | undefined;
let latest: GraphDoc | undefined;

/**
 * Remember where we are, debounced.
 *
 * Every keystroke in a Words node changes the graph, so writing on each one
 * would be a file write per character.
 */
export function rememberOpenGraph(doc: GraphDoc): void {
  latest = doc;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = undefined;
    if (latest) void saveGraph(OPEN_ID, latest).catch(() => undefined);
  }, 1000);
}
