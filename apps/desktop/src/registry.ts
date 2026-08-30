import { loadLayers, RENDERERS, type LoadedRegistry } from '@dialect/core';
import { BUILTIN_CARDS } from './channel.ts';

/**
 * The registry the window starts with: the cards this build shipped.
 *
 * Replaced at startup by `loadRegistry`, which lays an installed set and any
 * hand-written cards on top. This one exists so the first render has something
 * to render — reading the others is a round trip to the host.
 */
export const BUILTIN: LoadedRegistry = loadLayers(
  [{ origin: 'built in', cards: BUILTIN_CARDS }],
  { renderers: Object.keys(RENDERERS) },
);

export const sortProfiles = (loaded: LoadedRegistry) =>
  [...loaded.registry.profiles.values()].sort((a, b) => {
    if (a.family !== b.family) return a.family.localeCompare(b.family);
    return a.label.localeCompare(b.label);
  });
