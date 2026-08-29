import type { Provider, ProviderResult, StructuredRequest } from './types.ts';
import { ProviderError } from './types.ts';

/**
 * A provider that answers from a script instead of a network.
 *
 * Every test in this package runs against it, which is the point: the pipeline
 * has to be provable without a key, a bill, or a model's mood on the day.
 */
export class MockProvider implements Provider {
  readonly id = 'mock';
  readonly model: string;
  readonly calls: Array<StructuredRequest<unknown>> = [];

  #answers: unknown[];
  #costPerCall: number;

  constructor(answers: unknown[], options: { model?: string; costPerCall?: number } = {}) {
    this.#answers = [...answers];
    this.model = options.model ?? 'mock-1';
    this.#costPerCall = options.costPerCall ?? 0.01;
  }

  async extract<T>(request: StructuredRequest<T>): Promise<ProviderResult<T>> {
    this.calls.push(request as StructuredRequest<unknown>);

    const next = this.#answers.shift();
    if (next === undefined) {
      throw new ProviderError('MockProvider ran out of scripted answers.', { retryable: false });
    }

    const parsed = request.schema.safeParse(next);
    if (!parsed.success) {
      throw new ProviderError(
        `MockProvider was given an answer that does not match the requested schema: ${parsed.error.message}`,
        { retryable: false },
      );
    }

    return {
      value: parsed.data,
      model: this.model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cachedInputTokens: 0,
        costUsd: this.#costPerCall,
      },
    };
  }
}
