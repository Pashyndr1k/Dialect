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
import { ALL_EXTENSIONS, EXTENSIONS, type ResultCache } from '@dialect/core';

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

/** Whether the window is running inside the app rather than a plain browser. */
export const hasDesktop = (): boolean => hasHost();

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

/**
 * Bumped to 2 when the panels went: a session used to hold the open document,
 * the chosen target and the batch list, and now holds none of them. Where the
 * work is lives in the graph, which is a file of its own.
 */
export const SESSION_VERSION = 2 as const;

/**
 * What survives a restart that belongs to nothing else.
 *
 * One thing: what has been spent. A cap that resets when the window closes is
 * not a cap, and this is the only reason the file still exists.
 */
export interface Session {
  version: typeof SESSION_VERSION;
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

// showFolder moved to folders.ts, where the permission it needs is asked for.
export { showFolder } from './folders.ts';

// ---------------------------------------------------------------------------
// Reading a video
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

/** Whether a video can be read here at all, so the window can say so up front. */
export async function mediaTools(): Promise<MediaTools> {
  if (!hasHost()) return { ffmpeg: false, ffprobe: false };
  try {
    return await invoke<MediaTools>('media_tools', {});
  } catch {
    return { ffmpeg: false, ffprobe: false };
  }
}

/**
 * References come in by path, not by drop.
 *
 * A dropped file reaches the page as bytes with no name on disk, and handing a
 * few hundred megabytes across as base64 just to have ffmpeg read it would be
 * absurd. So files are chosen, and only paths travel — for every kind, because
 * one button cannot take three kinds if one of them arrives differently.
 */
export async function pickReferences(imagesOnly = false): Promise<string[]> {
  if (!hasHost()) {
    throw new Error('Choosing files needs the desktop app.');
  }

  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    multiple: true,
    title: 'Choose references',
    // Without ffmpeg a video cannot be read at all, so it is not offered rather
    // than accepted and refused later.
    filters: imagesOnly
      ? [{ name: 'Images', extensions: [...EXTENSIONS.image] }]
      : [
          { name: 'References', extensions: [...ALL_EXTENSIONS] },
          { name: 'Images', extensions: [...EXTENSIONS.image] },
          { name: 'Video', extensions: [...EXTENSIONS.video] },
          { name: 'Audio', extensions: [...EXTENSIONS.audio] },
        ],
  });

  if (typeof picked === 'string') return [picked];
  return Array.isArray(picked) ? picked.filter((p): p is string => typeof p === 'string') : [];
}

/** A folder of references, listed by the host so every kind arrives by path. */
export async function pickFolder(): Promise<string | null> {
  if (!hasHost()) {
    throw new Error('Choosing a folder needs the desktop app.');
  }

  const { open } = await import('@tauri-apps/plugin-dialog');
  const dir = await open({ directory: true, title: 'Choose a folder of references' });
  return typeof dir === 'string' ? dir : null;
}

export interface Found {
  name: string;
  path: string;
  bytes: number;
}

export const scanFolder = (dir: string): Promise<Found[]> =>
  invoke<Found[]>('folder_scan', { dir });

/** Bytes off disk, for an image the host picked rather than the page received. */
export const readFile = (path: string): Promise<{ base64: string; bytes: number }> =>
  invoke<{ base64: string; bytes: number }>('file_read', { path });

/**
 * Something to recognise a reference by, whatever kind it is: the image, the
 * video's first frame, or the audio's spectrogram.
 */
export async function thumbOf(path: string): Promise<string | undefined> {
  if (!hasHost()) return undefined;
  try {
    return `data:image/jpeg;base64,${await invoke<string>('file_thumb', { path })}`;
  } catch {
    // A reference with no picture is still a reference.
    return undefined;
  }
}

export const probeVideo = (path: string): Promise<VideoProbe> =>
  invoke<VideoProbe>('media_probe', { path });

export const videoFrames = (path: string, count = 5): Promise<VideoFrame[]> =>
  invoke<VideoFrame[]>('media_frames', { path, count });

// ---------------------------------------------------------------------------
// Reading audio
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

export const measureAudio = (path: string): Promise<Measured> =>
  invoke<Measured>('audio_measure', { path });
