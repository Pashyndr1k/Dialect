/**
 * The gateway: one place where money is spent.
 *
 * Everything that costs anything goes through here, which is what makes a
 * budget cap and a cache possible at all. Callers ask for a structured answer;
 * the gateway decides whether that means a network call.
 */

import { MemoryCache, sha256Hex, type ResultCache } from './cache.ts';
import {
  BudgetExceededError,
  ZERO_USAGE,
  type Provider,
  type ProviderResult,
  type ProviderUsage,
  type StructuredRequest,
} from './types.ts';

export interface GatewayOptions {
  cache?: ResultCache;
  /** Hard ceiling in USD for this gateway's lifetime. Omit for no cap. */
  budgetUsd?: number;
  /** Called after every billed call, for progress display. */
  onSpend?: (usage: ProviderUsage, total: number) => void;
}

export interface GatewayResult<T> extends ProviderResult<T> {
  /** True when nothing was spent because the answer was already known. */
  cached: boolean;
  /**
   * Where this answer sits in the cache. Handed back so a caller can keep its
   * own index — the key alone says nothing a person would recognise.
   */
  key: string;
  /** When a reused answer was first bought. Absent on a fresh call. */
  cachedAt?: string;
}

/**
 * What a cache entry holds.
 *
 * The answer, and the two facts about it that only stop being obvious once the
 * model can change underneath: who produced it and when. Both live in the entry
 * rather than in its key, so an answer survives a change of model and can still
 * say where it came from.
 */
interface Held {
  /** Bumped if this shape ever changes. Absent means the original bare value. */
  v?: 1;
  model?: string;
  at?: string;
  value: unknown;
}

const wrap = (value: unknown, model: string): Held => ({
  v: 1,
  model,
  at: new Date().toISOString(),
  value,
});

/**
 * Read an entry, in either shape.
 *
 * Entries written before answers carried their provenance are bare values. They
 * are still perfectly good answers — they simply cannot say which model gave
 * them — so they are used rather than thrown away.
 */
function unwrap(stored: unknown): { value: unknown; model?: string; at?: string } {
  if (stored !== null && typeof stored === 'object' && (stored as Held).v === 1) {
    const held = stored as Held;
    return {
      value: held.value,
      ...(held.model ? { model: held.model } : {}),
      ...(held.at ? { at: held.at } : {}),
    };
  }
  return { value: stored };
}

export class Gateway {
  readonly #provider: Provider;
  readonly #cache: ResultCache;
  readonly #budgetUsd: number | undefined;
  readonly #onSpend: GatewayOptions['onSpend'];
  #spentUsd = 0;

  constructor(provider: Provider, options: GatewayOptions = {}) {
    this.#provider = provider;
    this.#cache = options.cache ?? new MemoryCache();
    this.#budgetUsd = options.budgetUsd;
    this.#onSpend = options.onSpend;
  }

  get spentUsd(): number {
    return this.#spentUsd;
  }

  /**
   * Carry a running total in from a session being resumed.
   *
   * Without this the cap forgot everything spent before the window closed: the
   * screen said four dollars gone and the gateway would still allow five more.
   * Monotonic on purpose — a total can be brought forward, never wound back,
   * so this cannot be used to clear the cap.
   */
  restoreSpend(total: number): void {
    if (Number.isFinite(total) && total > this.#spentUsd) this.#spentUsd = total;
  }

  get remainingUsd(): number | undefined {
    return this.#budgetUsd === undefined ? undefined : this.#budgetUsd - this.#spentUsd;
  }

  /**
   * The question, not who was asked.
   *
   * The model is deliberately absent. What is cached is the reading of a
   * reference — what the picture shows — and that is a fact about the picture,
   * so changing model must not mean paying to look at everything again. Which
   * model produced an answer is recorded *in* the answer instead, so nothing is
   * lost; it only moves out of the identity of the question.
   *
   * The adapter id stays: a mock's scripted answer must never reach a real run.
   */
  async keyFor<T>(request: StructuredRequest<T>): Promise<string> {
    const parts = [
      this.#provider.id,
      request.schemaVersion,
      request.system,
      request.instruction,
      ...(request.images ?? []).map((i) => `${i.mediaType}:${i.base64.length}:${i.base64}`),
    ];
    return sha256Hex(parts.join('\u0000'));
  }

  async extract<T>(request: StructuredRequest<T>): Promise<GatewayResult<T>> {
    const key = await this.keyFor(request);

    const hit = await this.#cache.get(key);
    if (hit !== undefined) {
      const held = unwrap(hit);
      // Re-validate: a cached answer written by an older build must not slip
      // past the current schema just because it is on disk.
      const parsed = request.schema.safeParse(held.value);
      if (parsed.success) {
        return {
          value: parsed.data,
          usage: ZERO_USAGE,
          // The model that actually produced this, which is not necessarily the
          // one selected now. Saying otherwise would be a small lie told every
          // time an old answer is reused.
          model: held.model ?? this.#provider.model,
          cached: true,
          key,
          ...(held.at ? { cachedAt: held.at } : {}),
        };
      }
    }

    // Checked before the call, so a cap is never discovered after the spend.
    if (this.#budgetUsd !== undefined && this.#spentUsd >= this.#budgetUsd) {
      throw new BudgetExceededError(this.#spentUsd, this.#budgetUsd);
    }

    const result = await this.#provider.extract(request);
    this.#spentUsd += result.usage.costUsd;
    this.#onSpend?.(result.usage, this.#spentUsd);

    await this.#cache.set(key, wrap(result.value, result.model));
    return { ...result, cached: false, key };
  }
}
