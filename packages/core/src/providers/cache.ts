/**
 * Content-addressed result cache.
 *
 * Extraction is the only expensive step in the pipeline, so the second run over
 * a folder should cost nothing. The key covers the images, the question, the
 * schema version and the model — change any of them and the answer is fetched
 * again; change none and it never is.
 */

export interface ResultCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

/** Default cache. A persistent one lands with the batch queue. */
export class MemoryCache implements ResultCache {
  readonly #entries = new Map<string, unknown>();

  async get(key: string): Promise<unknown | undefined> {
    return this.#entries.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.#entries.set(key, value);
  }

  get size(): number {
    return this.#entries.size;
  }
}

/** Web Crypto rather than node:crypto, so core still runs in the window. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
