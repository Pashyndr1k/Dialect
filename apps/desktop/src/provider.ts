/**
 * The window's provider: the same `Provider` contract the CLI satisfies with
 * the Anthropic SDK, satisfied here by handing the request to the Rust host.
 *
 * Nothing about the request differs — same schema, same prompt, same gateway,
 * same cache and budget. What differs is who holds the credential. The host
 * fetches it from the OS credential store and makes the call; the web view
 * never sees it, and has no command with which to ask.
 */

import { invoke } from '@tauri-apps/api/core';
import * as z from 'zod';
import {
  costUsd,
  ProviderError,
  type Provider,
  type ProviderResult,
  type StructuredRequest,
} from '@dialect/core';

interface HostUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

interface HostResponse {
  value: unknown;
  model: string;
  usage: HostUsage;
}

export interface HostProviderOptions {
  model?: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export class HostProvider implements Provider {
  readonly id = 'anthropic-host';
  readonly model: string;

  readonly #maxTokens: number;
  readonly #effort: HostProviderOptions['effort'];

  constructor(options: HostProviderOptions = {}) {
    this.model = options.model ?? 'claude-sonnet-5';
    this.#maxTokens = options.maxTokens ?? 16000;
    this.#effort = options.effort;
  }

  async extract<T>(request: StructuredRequest<T>): Promise<ProviderResult<T>> {
    // The dev server in a plain browser has no host to call, and the raw
    // failure for that is an unreadable TypeError about `invoke`.
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      throw new ProviderError(
        'Reading a reference needs the desktop app: a browser has no host to make the call, ' +
          'and the key never leaves the host by design.',
        { retryable: false },
      );
    }

    let response: HostResponse;
    try {
      response = await invoke<HostResponse>('anthropic_extract', {
        request: {
          system: request.system,
          instruction: request.instruction,
          images: (request.images ?? []).map((i) => ({
            media_type: i.mediaType,
            base64: i.base64,
          })),
          // The host does not know Zod, so the schema crosses as plain JSON Schema.
          schema: z.toJSONSchema(request.schema),
          model: this.model,
          max_tokens: this.#maxTokens,
          effort: this.#effort ?? null,
        },
      });
    } catch (err) {
      // Tauri surfaces a command's Err as a plain string.
      const message = typeof err === 'string' ? err : String(err);
      throw new ProviderError(message, {
        retryable: /rate limited|could not reach/i.test(message),
        cause: err,
      });
    }

    // The host checked that the answer was JSON; this checks it is the right JSON.
    const parsed = request.schema.safeParse(response.value);
    if (!parsed.success) {
      throw new ProviderError(
        `The model's answer did not match the requested shape: ${parsed.error.message}`,
        { retryable: true },
      );
    }

    return {
      value: parsed.data,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.cache_read_input_tokens,
        costUsd: costUsd(response.model, response.usage),
      },
    };
  }
}
