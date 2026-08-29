/**
 * Per-model rates, in dollars per million tokens.
 *
 * Kept as data next to the adapter rather than hard-coded into it: rates change,
 * and a wrong number here silently corrupts every budget cap downstream.
 */

export interface Rates {
  input: number;
  output: number;
  /** Cache reads bill at roughly a tenth of the input rate. */
  cacheRead: number;
  /** Cache writes bill at roughly 1.25x the input rate. */
  cacheWrite: number;
}

const RATES: Record<string, Rates> = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Falls back to Opus rates: over-estimating a budget is the safe direction. */
export function ratesFor(model: string): Rates {
  return RATES[model] ?? RATES['claude-opus-5']!;
}

export function costUsd(
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
): number {
  const r = ratesFor(model);
  const M = 1_000_000;
  return (
    (usage.input_tokens * r.input) / M +
    (usage.output_tokens * r.output) / M +
    ((usage.cache_read_input_tokens ?? 0) * r.cacheRead) / M +
    ((usage.cache_creation_input_tokens ?? 0) * r.cacheWrite) / M
  );
}
