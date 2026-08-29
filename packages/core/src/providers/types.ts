/**
 * The provider boundary.
 *
 * Core never imports a vendor SDK. It describes what it needs — a structured
 * answer about some images — and an adapter in `@dialect/providers` satisfies
 * it. That keeps the compiler portable, keeps tests free of network calls, and
 * makes "bring your own key" a configuration question rather than a rewrite.
 */

import type { ZodType } from 'zod';

export interface ImagePart {
  /** e.g. `image/png`. */
  mediaType: string;
  /** Raw base64, no data: prefix. */
  base64: string;
}

export interface StructuredRequest<T> {
  /** Stable across calls, so it caches well. */
  system: string;
  /** The per-call instruction. */
  instruction: string;
  images?: ImagePart[];
  schema: ZodType<T>;
  /**
   * Bumped whenever the schema or the prompt changes. Part of the cache key, so
   * old answers are not reused against a new question.
   */
  schemaVersion: string;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
}

export interface ProviderResult<T> {
  value: T;
  usage: ProviderUsage;
  model: string;
}

export interface Provider {
  /** Adapter id, e.g. `anthropic`. Part of the cache key. */
  readonly id: string;
  /** Model id, e.g. `claude-opus-5`. Part of the cache key. */
  readonly model: string;
  extract<T>(request: StructuredRequest<T>): Promise<ProviderResult<T>>;
}

export const ZERO_USAGE: ProviderUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  costUsd: 0,
};

export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = options.retryable;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** Raised before a call is made, never after money has already been spent. */
export class BudgetExceededError extends Error {
  readonly spentUsd: number;
  readonly capUsd: number;
  constructor(spentUsd: number, capUsd: number) {
    super(
      `This run has spent $${spentUsd.toFixed(4)} of its $${capUsd.toFixed(2)} cap. ` +
        `Raise the cap or clear it to continue.`,
    );
    this.name = 'BudgetExceededError';
    this.spentUsd = spentUsd;
    this.capUsd = capUsd;
  }
}
