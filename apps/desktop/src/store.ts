/**
 * What survives closing the window.
 *
 * The cache holds answers that were paid for, so re-reading a reference the app
 * has seen before costs nothing. The session holds what was on screen: which
 * references were read and what came back.
 *
 * Neither can be kept by the web view itself, so both live with the host. In a
 * plain browser there is no host, and both fall back to memory — which is what
 * the dev server has always had.
 */

import { invoke } from '@tauri-apps/api/core';
import type { PromptIR, ResultCache } from '@dialect/core';
import type { BatchItem } from './Batch.tsx';

const hasHost = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * The gateway's cache, kept by the host.
 *
 * A read that fails is a miss rather than an error: a cache that cannot be
 * reached should slow the app down, not stop it.
 */
export class HostCache implements ResultCache {
  readonly #memory = new Map<string, unknown>();

  async get(key: string): Promise<unknown | undefined> {
    if (!hasHost()) return this.#memory.get(key);

    try {
      const text = await invoke<string | null>('cache_get', { key });
      return text === null ? undefined : (JSON.parse(text) as unknown);
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!hasHost()) {
      this.#memory.set(key, value);
      return;
    }
    try {
      await invoke<void>('cache_set', { key, value: JSON.stringify(value) });
    } catch {
      // Losing a cache write costs money later, not correctness now.
    }
  }
}

export interface CacheStats {
  entries: number;
  bytes: number;
}

export async function cacheStats(): Promise<CacheStats | null> {
  if (!hasHost()) return null;
  try {
    return await invoke<CacheStats>('cache_stats', {});
  } catch {
    return null;
  }
}

export async function clearCache(): Promise<number> {
  if (!hasHost()) return 0;
  return invoke<number>('cache_clear', {});
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

export const SESSION_VERSION = 1 as const;

export interface Session {
  version: typeof SESSION_VERSION;
  target: string;
  /** The document that was open. */
  ir?: PromptIR;
  /** The batch list, with the IR each finished item produced. */
  items: Array<BatchItem & { ir?: PromptIR }>;
  spentUsd: number;
}

let memorySession: Session | undefined;

export async function loadSession(): Promise<Session | undefined> {
  if (!hasHost()) return memorySession;

  try {
    const text = await invoke<string | null>('session_get', {});
    if (text === null) return undefined;

    const parsed = JSON.parse(text) as Session;
    // A session written by an older build is discarded rather than half-read.
    return parsed.version === SESSION_VERSION ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function saveSession(session: Session): Promise<void> {
  if (!hasHost()) {
    memorySession = session;
    return;
  }
  try {
    await invoke<void>('session_set', { value: JSON.stringify(session) });
  } catch {
    // Not worth interrupting anyone over; the work itself is unaffected.
  }
}

export async function clearSession(): Promise<void> {
  memorySession = undefined;
  if (hasHost()) await invoke<void>('session_clear', {}).catch(() => undefined);
}
