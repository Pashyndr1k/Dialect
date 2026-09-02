/**
 * The Anthropic adapter.
 *
 * Structured outputs do the heavy lifting: the model is handed the same Zod
 * schema core validates against, so a malformed answer is the API's problem
 * rather than a parser we would otherwise have to write and keep honest.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Provider, ProviderResult, StructuredRequest } from '@dialect/core';
import { costUsd, ProviderError } from '@dialect/core';

export interface AnthropicProviderOptions {
  /**
   * Omit to let the SDK resolve credentials the way it normally does:
   * ANTHROPIC_API_KEY, then ANTHROPIC_AUTH_TOKEN, then an `ant auth login`
   * profile. Pass a key only when injecting a specific one.
   */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** low | medium | high | xhigh | max. Left to the API default when unset. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic';
  readonly model: string;

  readonly #client: Anthropic;
  readonly #maxTokens: number;
  readonly #effort: AnthropicProviderOptions['effort'];

  constructor(options: AnthropicProviderOptions = {}) {
    this.#client = options.apiKey ? new Anthropic({ apiKey: options.apiKey }) : new Anthropic();
    this.model = options.model ?? 'claude-sonnet-5';
    this.#maxTokens = options.maxTokens ?? 16000;
    this.#effort = options.effort;
  }

  async extract<T>(request: StructuredRequest<T>): Promise<ProviderResult<T>> {
    const content: Anthropic.ContentBlockParam[] = [
      ...(request.images ?? []).map(
        (img): Anthropic.ContentBlockParam => ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
            data: img.base64,
          },
        }),
      ),
      { type: 'text', text: request.instruction },
    ];

    let response;
    try {
      response = await this.#client.messages.parse({
        model: this.model,
        max_tokens: this.#maxTokens,
        system: request.system,
        // Reading a picture into twenty-odd structured fields is not a
        // one-glance task, so let the model think about it.
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content }],
        output_config: {
          ...(this.#effort ? { effort: this.#effort } : {}),
          format: zodOutputFormat(request.schema),
        },
      });
    } catch (err) {
      throw toProviderError(err);
    }

    // Always check why it stopped before reading what it said.
    if (response.stop_reason === 'refusal') {
      // Server-side fallbacks are not wired here: they live on the beta
      // messages endpoint, and this path is the structured-output one.
      throw new ProviderError(
        `The model declined this reference${
          response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'
        }`,
        { retryable: false },
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ProviderError(
        `The description was cut off at ${this.#maxTokens} tokens. Raise maxTokens.`,
        { retryable: false },
      );
    }

    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) {
      throw new ProviderError(
        'The model returned something that did not match the requested shape.',
        { retryable: true },
      );
    }

    return {
      value: parsed,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
        costUsd: costUsd(response.model, response.usage),
      },
    };
  }
}

/** Most specific first, so a 404 is never mistaken for something worth retrying. */
function toProviderError(err: unknown): ProviderError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new ProviderError(
      'Anthropic rejected the credentials. Set ANTHROPIC_API_KEY, or run `ant auth login`.',
      { retryable: false, cause: err },
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError('Rate limited by Anthropic.', { retryable: true, cause: err });
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new ProviderError(`Anthropic rejected the request: ${err.message}`, {
      retryable: false,
      cause: err,
    });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError('Could not reach Anthropic.', { retryable: true, cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    return new ProviderError(`Anthropic error ${err.status}: ${err.message}`, {
      retryable: (err.status ?? 0) >= 500,
      cause: err,
    });
  }
  return new ProviderError(String(err), { retryable: false, cause: err });
}
