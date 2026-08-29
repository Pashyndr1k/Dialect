/**
 * API keys at rest.
 *
 * Same shape as StoryReel's: the key is typed into the app's own settings, the
 * OS keeps it, and a plain dev browser falls back to something obviously less
 * safe rather than pretending. What differs is where it lands — Tauri has no
 * `safeStorage`, so instead of an encrypted blob in localStorage the key goes
 * straight into the OS credential store: Windows Credential Manager, the macOS
 * Keychain, the Secret Service on Linux.
 *
 * There is no way to read a stored key back out. The host makes the model call
 * itself, so the value has no reason to enter the web view at all — and with no
 * command to fetch it, that is a property of the build rather than a promise.
 */

const FALLBACK_KEY = 'dialect.settings.insecure.v1';

export type SecretStore =
  /** The OS credential store, via the Tauri host. */
  | 'os'
  /** A dev browser with no host: localStorage, in the clear. */
  | 'browser';

export interface SecretStatus {
  store: SecretStore;
  stored: boolean;
}

function hasHost(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(command, args);
}

/** Where secrets will actually go in this build. */
export async function secretStore(): Promise<SecretStore> {
  if (!hasHost()) return 'browser';
  try {
    return (await invoke<boolean>('secret_available', {})) ? 'os' : 'browser';
  } catch {
    return 'browser';
  }
}

function readFallback(name: string): string {
  try {
    const raw = window.localStorage.getItem(FALLBACK_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && name in parsed) {
      const value = (parsed as Record<string, unknown>)[name];
      return typeof value === 'string' ? value : '';
    }
  } catch {
    // A browser with storage blocked is a fallback that has no fallback.
  }
  return '';
}

function writeFallback(name: string, value: string): void {
  try {
    const raw = window.localStorage.getItem(FALLBACK_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const next: Record<string, unknown> =
      parsed && typeof parsed === 'object' ? { ...(parsed as Record<string, unknown>) } : {};

    if (value) next[name] = value;
    else delete next[name];

    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(next));
  } catch {
    // Nothing sensible to do: the panel already says storage is unavailable.
  }
}

export async function setSecret(name: string, value: string): Promise<void> {
  const trimmed = value.trim();
  if ((await secretStore()) === 'os') {
    await invoke<void>('secret_set', { name, value: trimmed });
    return;
  }
  writeFallback(name, trimmed);
}

export async function clearSecret(name: string): Promise<void> {
  if ((await secretStore()) === 'os') {
    await invoke<void>('secret_delete', { name });
    return;
  }
  writeFallback(name, '');
}

export async function secretStatus(name: string): Promise<SecretStatus> {
  const store = await secretStore();
  if (store === 'os') {
    return { store, stored: await invoke<boolean>('secret_has', { name }) };
  }
  return { store, stored: readFallback(name).length > 0 };
}

/** The one key the app needs so far. */
export const ANTHROPIC_KEY = 'anthropic';
