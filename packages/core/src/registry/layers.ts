/**
 * A registry in layers: what shipped, what arrived, what someone wrote.
 *
 * Cards are dated, so the set has to be replaceable — and the moment it is
 * replaceable, loading it has to stop being all-or-nothing. A set of eleven
 * cards where one is malformed should give ten cards and a complaint, not an
 * empty window. The old card underneath it stands, which is the difference
 * between a bad update being an inconvenience and being an outage.
 *
 * Rejection happens here rather than at render time for the same reason. A card
 * naming a renderer this build has never heard of is not a card; finding that
 * out when someone presses the button, having already paid to read a reference,
 * is finding out too late.
 */

import type { ModelProfile, Registry } from './types.ts';
import { createRegistry, parseProfile, ProfileError } from './load.ts';

export interface CardSource {
  /** File name, for saying which card was the problem. */
  source: string;
  text: string;
}

export interface Layer {
  /** Where these came from, e.g. `built in`, `channel`, `yours`. */
  origin: string;
  cards: CardSource[];
}

export interface Rejection {
  source: string;
  origin: string;
  reason: string;
}

export interface LoadedRegistry {
  registry: Registry;
  /** Which layer each card that survived came from. */
  origin: Map<string, string>;
  /** What would not load, and why. Reported rather than thrown. */
  rejected: Rejection[];
}

/**
 * A card is only usable if this build can actually render it.
 *
 * Passed in rather than imported so this file does not depend on the renderers:
 * the caller knows what it has.
 */
export interface LayerOptions {
  renderers?: readonly string[];
}

function unusable(profile: ModelProfile, options: LayerOptions): string | undefined {
  const known = options.renderers;
  if (known && !known.includes(profile.renderer)) {
    return `it asks for the "${profile.renderer}" renderer, which this build does not have (${known.join(', ')})`;
  }
  if (profile.renderer === 'field-list' && !profile.fields?.length) {
    return 'it renders as a field list but names no fields';
  }
  return undefined;
}

/**
 * Later layers win by id; a card that will not load leaves the one below it.
 */
export function loadLayers(layers: Layer[], options: LayerOptions = {}): LoadedRegistry {
  const kept = new Map<string, ModelProfile>();
  const origin = new Map<string, string>();
  const rejected: Rejection[] = [];

  for (const layer of layers) {
    // Within one layer, the first card to claim an id keeps it: a set that
    // contradicts itself is a mistake, and picking the later one silently would
    // make which mistake you get depend on file order.
    const claimed = new Set<string>();

    for (const card of layer.cards) {
      const complain = (reason: string): void => {
        rejected.push({ source: card.source, origin: layer.origin, reason });
      };

      let profile: ModelProfile;
      try {
        profile = parseProfile(card.text, card.source);
      } catch (err) {
        complain(err instanceof ProfileError ? err.message.replace(/^Model profile [^ ]+ is not usable: /, '') : String(err));
        continue;
      }

      if (claimed.has(profile.id)) {
        complain(`two cards in ${layer.origin} claim the id "${profile.id}"`);
        continue;
      }

      const problem = unusable(profile, options);
      if (problem) {
        complain(problem);
        continue;
      }

      claimed.add(profile.id);
      kept.set(profile.id, profile);
      origin.set(profile.id, layer.origin);
    }
  }

  return { registry: createRegistry([...kept.values()]), origin, rejected };
}

/** The most recent date any surviving card carries, for showing how old the set is. */
export function newestCard(registry: Registry): string | undefined {
  const dates = [...registry.profiles.values()]
    .map((p) => p.source?.dated)
    .filter((d): d is string => Boolean(d))
    .sort();
  return dates.at(-1);
}
