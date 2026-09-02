/**
 * One gateway for the window's lifetime.
 *
 * Its cache and its running total survive between runs, so re-reading the same
 * reference costs nothing. It lives here rather than inside a component because
 * two of them would be two budget counters, and a five dollar cap counted twice
 * is a ten dollar cap — which is the bug that let a session spend past its own
 * ceiling once already.
 */

import { Gateway } from '@dialect/core';

import { HostProvider } from './provider.ts';
import { hostCache, loadSession, saveSession, SESSION_VERSION } from './store.ts';

export const BUDGET_USD = 5;

export const gateway = new Gateway(new HostProvider(), {
  cache: hostCache,
  budgetUsd: BUDGET_USD,
  onSpend: (_usage, total) => {
    window.dispatchEvent(new CustomEvent('dialect:spend', { detail: total }));
    void remember(total);
  },
});

/** Subscribe to the running total. Returns the unsubscribe. */
export function onSpend(handler: (total: number) => void): () => void {
  const listener = (e: Event): void => handler((e as CustomEvent<number>).detail);
  window.addEventListener('dialect:spend', listener);
  return () => window.removeEventListener('dialect:spend', listener);
}

/*
 * Keeping the total across restarts.
 *
 * A cap that resets when the window closes is not a cap. The panels did this
 * for themselves and the canvas did not, so a graph could spend five dollars,
 * be reopened, and spend five more — the same hole, reopened in a new view. It
 * belongs to the gateway rather than to whichever screen is showing.
 *
 * Only `spentUsd` is touched; whatever else the session holds is written back
 * as it was found.
 */

let pending: ReturnType<typeof setTimeout> | undefined;
let latest = 0;

async function write(total: number): Promise<void> {
  try {
    await saveSession({ version: SESSION_VERSION, spentUsd: total });
  } catch {
    // A total that cannot be written is not worth failing a run over. The cap
    // still holds for this window; it is only the next one that forgets.
  }
}

/** Debounced: a folder of twenty references must not mean twenty writes. */
function remember(total: number): void {
  latest = total;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = undefined;
    void write(latest);
  }, 800);
}

/**
 * Put back what earlier sessions spent. Call once, at startup.
 *
 * `restoreSpend` only ever moves the total up, so this cannot be used to lower
 * a cap that has already been reached.
 */
export async function restoreSpend(): Promise<number> {
  try {
    const session = await loadSession();
    if (session?.spentUsd) gateway.restoreSpend(session.spentUsd);
  } catch {
    /* Nothing stored, or nothing readable. Start from zero. */
  }
  return gateway.spentUsd;
}
