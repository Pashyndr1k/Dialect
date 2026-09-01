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
import { hostCache } from './store.ts';

export const BUDGET_USD = 5;

export const gateway = new Gateway(new HostProvider(), {
  cache: hostCache,
  budgetUsd: BUDGET_USD,
  onSpend: (_usage, total) =>
    window.dispatchEvent(new CustomEvent('dialect:spend', { detail: total })),
});

/** Subscribe to the running total. Returns the unsubscribe. */
export function onSpend(handler: (total: number) => void): () => void {
  const listener = (e: Event): void => handler((e as CustomEvent<number>).detail);
  window.addEventListener('dialect:spend', listener);
  return () => window.removeEventListener('dialect:spend', listener);
}
