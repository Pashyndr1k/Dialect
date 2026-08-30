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

  get remainingUsd(): number | undefined {
    return this.#budgetUsd === undefined ? undefined : this.#budgetUsd - this.#spentUsd;
  }

  async keyFor<T>(request: StructuredRequest<T>): Promise<string> {
    const parts = [
      this.#provider.id,
      this.#provider.model,
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
      // Re-validate: a cached answer written by an older build must not slip
      // past the current schema just because it is on disk.
      const parsed = request.schema.safeParse(hit);
      if (parsed.success) {
        return {
          value: parsed.data,
          usage: ZERO_USAGE,
          model: this.#provider.model,
          cached: true,
          key,
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

    await this.#cache.set(key, result.value);
    return { ...result, cached: false, key };
  }
}
