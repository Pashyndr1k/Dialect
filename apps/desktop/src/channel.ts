import { invoke } from '@tauri-apps/api/core';
import { loadLayers, RENDERERS, type CardSource, type LoadedRegistry } from '@dialect/core';
import { showFolder } from './folders.ts';

/**
 * Where the model cards come from.
 *
 * Three layers, in this order: what the build shipped, what a signed set
 * brought, what someone wrote themselves. Later wins by id, so an update can
 * correct a card without a new binary and a hand-written card can override
 * either — which is the whole point of the cards being data.
 *
 * Installing is not here. The host reads and writes the folder; this side asks
 * and shows what came back.
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

export const checkChannel = (source: string): Promise<Checked> =>
  invoke<Checked>('channel_check', { source });

export const installChannel = (source: string, force = false): Promise<ChannelStatus> =>
  invoke<ChannelStatus>('channel_install', { source, force });

export const revertChannel = (): Promise<ChannelStatus> =>
  invoke<ChannelStatus>('channel_revert', {});

/** The two layers that are read from disk, for looking at and editing. */
export const channelCards = (): Promise<CardSource[]> => fromHost('channel_cards');
export const myCards = (): Promise<CardSource[]> => fromHost('my_cards');

/**
 * One card of your own, written or replaced. Returns where it landed.
 *
 * Only your own: the built-in cards are in the binary, and an installed set is
 * replaced wholesale by the next install — an edit to either would be lost or
 * impossible. Editing one of those means taking a copy first, which is what the
 * panel offers, and the copy wins anyway because your layer loads last.
 */
export const saveMyCard = (name: string, text: string): Promise<string> =>
  invoke<string>('my_card_save', { name, text });

export const deleteMyCard = (name: string): Promise<void> =>
  invoke<void>('my_card_delete', { name });

export async function openCardsFolder(): Promise<void> {
  if (!hasHost()) throw new Error('Opening a folder needs the desktop app.');
  await showFolder(await invoke<string>('cards_folder', {}));
}
