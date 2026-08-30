import { invoke } from '@tauri-apps/api/core';
import { loadLayers, RENDERERS, type CardSource, type LoadedRegistry } from '@dialect/core';

/**
 * Where the model cards come from.
 *
 * Three layers, in this order: what the build shipped, what a signed set
 * brought, what someone wrote themselves. Later wins by id, so an update can
 * correct a card without a new binary and a hand-written card can override
 * either — which is the whole point of the cards being data.
 *
 * Verification is not here. A signature checked by the page that the signature
 * is protecting is not a check, so the host does it and this side only asks for
 * what has already been verified.
 */

const hasHost = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const shipped = import.meta.glob('../../../packages/core/src/registry/models/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const BUILTIN_CARDS: CardSource[] = Object.entries(shipped).map(([path, text]) => ({
  source: path.slice(path.lastIndexOf('/') + 1),
  text,
}));

export interface ChannelStatus {
  trusted_key: string | null;
  channel: string | null;
  version: number | null;
  published: string | null;
  cards: number;
  source: string | null;
}

export interface Checked {
  channel: string;
  version: number;
  published: string;
  cards: number;
  stale: boolean;
}

const asCards = (pairs: Array<[string, string]>): CardSource[] =>
  pairs.map(([source, text]) => ({ source, text }));

async function fromHost(command: string): Promise<CardSource[]> {
  if (!hasHost()) return [];
  try {
    return asCards(await invoke<Array<[string, string]>>(command, {}));
  } catch {
    // A card set that cannot be read is a set that is not there. The built-in
    // one still works, which is the point of it being underneath.
    return [];
  }
}

/** The registry as it actually stands, with what would not load reported. */
export async function loadRegistry(): Promise<LoadedRegistry> {
  const [installed, mine] = await Promise.all([fromHost('channel_cards'), fromHost('my_cards')]);

  return loadLayers(
    [
      { origin: 'built in', cards: BUILTIN_CARDS },
      { origin: 'channel', cards: installed },
      { origin: 'yours', cards: mine },
    ],
    { renderers: Object.keys(RENDERERS) },
  );
}

export const EMPTY_STATUS: ChannelStatus = {
  trusted_key: null,
  channel: null,
  version: null,
  published: null,
  cards: 0,
  source: null,
};

export async function channelStatus(): Promise<ChannelStatus> {
  if (!hasHost()) return EMPTY_STATUS;
  try {
    return await invoke<ChannelStatus>('channel_status', {});
  } catch {
    return EMPTY_STATUS;
  }
}

export const trustKey = (keyHex: string): Promise<string> =>
  invoke<string>('channel_trust', { keyHex });

export const distrustKey = (): Promise<void> => invoke<void>('channel_distrust', {});

export const checkChannel = (source: string): Promise<Checked> =>
  invoke<Checked>('channel_check', { source });

export const installChannel = (source: string, force = false): Promise<ChannelStatus> =>
  invoke<ChannelStatus>('channel_install', { source, force });

export const revertChannel = (): Promise<ChannelStatus> =>
  invoke<ChannelStatus>('channel_revert', {});

export async function openCardsFolder(): Promise<void> {
  if (!hasHost()) return;
  const dir = await invoke<string>('cards_folder', {});
  const { openPath } = await import('@tauri-apps/plugin-opener');
  await openPath(dir).catch(() => undefined);
}
