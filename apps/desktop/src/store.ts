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
  memoryLibrary = [];
  if (!hasHost()) return 0;
  return invoke<number>('cache_clear', {});
}

/**
 * The one cache the window uses.
 *
 * A shared instance, not a new one per call: without a host the fallback lives
 * in the instance, so a second HostCache would look into an empty map and
 * report a miss for something already there.
 */
export const hostCache = new HostCache();

/** Read an answer straight out of the cache, for a reference already paid for. */
export async function cachedAnswer(key: string): Promise<unknown | undefined> {
  return hostCache.get(key);
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

// ---------------------------------------------------------------------------
// The library: what the cache holds, in terms a person recognises
// ---------------------------------------------------------------------------

/**
 * A cache entry is keyed by a hash and holds only an answer — no name, no
 * picture, nothing anyone could pick out of a list. This is the index over
 * them, so a reference read last week can be found instead of paid for twice.
 */
export interface LibraryEntry {
  /** The cache key the answer is filed under. */
  key: string;
  /** What the file was called. */
  ref: string;
  /** ISO timestamp of the read that paid for it. */
  readAt: string;
  /** A small JPEG data URL, so it can be recognised on sight. */
  thumb?: string;
}

let memoryLibrary: LibraryEntry[] = [];

export async function loadLibrary(): Promise<LibraryEntry[]> {
  if (!hasHost()) return memoryLibrary;
  try {
    const parsed: unknown = JSON.parse(await invoke<string>('library_get', {}));
    return Array.isArray(parsed) ? (parsed as LibraryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Newest first, one entry per key: re-reading a reference updates its date. */
export async function rememberRead(entry: LibraryEntry): Promise<LibraryEntry[]> {
  const next = [entry, ...(await loadLibrary()).filter((e) => e.key !== entry.key)];

  if (!hasHost()) memoryLibrary = next;
  else {
    try {
      await invoke<void>('library_set', { value: JSON.stringify(next) });
    } catch {
      // The answer is still cached; only its label is lost.
    }
  }
  return next;
}

/** A small picture is worth keeping; a large one is not. */
export async function thumbnail(file: File, max = 240): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Saving prompts
// ---------------------------------------------------------------------------

export interface OutFile {
  name: string;
  contents: string;
}

/**
 * Ask where, write there, and offer to show it.
 *
 * Returns the folder, or null if the dialog was dismissed — the caller says
 * nothing in that case, because cancelling is not a failure.
 */
export async function savePromptsTo(files: OutFile[]): Promise<string | null> {
  if (!hasHost()) {
    throw new Error('Saving needs the desktop app: a browser cannot choose a folder to write to.');
  }

  const { open } = await import('@tauri-apps/plugin-dialog');
  const dir = await open({ directory: true, title: 'Where should the prompts go?' });
  if (typeof dir !== 'string') return null;

  await invoke<number>('save_prompts', { dir, files });
  return dir;
}

export async function showFolder(dir: string): Promise<void> {
  const { openPath } = await import('@tauri-apps/plugin-opener');
  await openPath(dir).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Reading a clip
// ---------------------------------------------------------------------------

export interface MediaTools {
  ffmpeg: boolean;
  ffprobe: boolean;
}

export interface VideoProbe {
  duration_s: number;
  width: number;
  height: number;
  fps: number;
  has_audio: boolean;
  aspect_ratio: string;
}

export interface VideoFrame {
  at: number;
  base64: string;
}

/** Whether a clip can be read here at all, so the window can say so up front. */
export async function mediaTools(): Promise<MediaTools> {
  if (!hasHost()) return { ffmpeg: false, ffprobe: false };
  try {
    return await invoke<MediaTools>('media_tools', {});
  } catch {
    return { ffmpeg: false, ffprobe: false };
  }
}

/**
 * A clip comes in by path, not by drop.
 *
 * A dropped file reaches the page as bytes with no name on disk, and handing a
 * few hundred megabytes across to the host as base64 just to have ffmpeg read
 * it would be absurd. So the file is chosen, and only the path travels.
 */
export async function pickVideo(): Promise<string | null> {
  if (!hasHost()) {
    throw new Error('Reading a clip needs the desktop app: a browser cannot reach ffmpeg.');
  }

  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({
    multiple: false,
    title: 'Choose a clip',
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'] }],
  });
  return typeof path === 'string' ? path : null;
}

export const probeVideo = (path: string): Promise<VideoProbe> =>
  invoke<VideoProbe>('media_probe', { path });

export const videoFrames = (path: string, count = 5): Promise<VideoFrame[]> =>
  invoke<VideoFrame[]>('media_frames', { path, count });

// ---------------------------------------------------------------------------
// Reading a track
// ---------------------------------------------------------------------------

export interface AudioTags {
  duration_s: number;
  sample_rate: number;
  channels: number;
  title: string | null;
  artist: string | null;
  genre: string | null;
}

export interface Measured {
  probe: AudioTags;
  tempo: { bpm: number; confidence: number } | null;
  key: { name: string; confidence: number } | null;
  lufs: number | null;
  lra: number | null;
  /** A spectrogram and a waveform, in that order. */
  pictures: Array<{ kind: string; base64: string }>;
}

/**
 * A track comes in by path, for the same reason a clip does: the host has to
 * run ffmpeg over it, and a file dropped on the page has no path on disk.
 */
export async function pickAudio(): Promise<string | null> {
  if (!hasHost()) {
    throw new Error('Reading a track needs the desktop app: a browser cannot reach ffmpeg.');
  }

  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({
    multiple: false,
    title: 'Choose a track',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'] }],
  });
  return typeof path === 'string' ? path : null;
}

export const measureAudio = (path: string): Promise<Measured> =>
  invoke<Measured>('audio_measure', { path });
