import { parseDecks, type Deck } from '@dialect/core';

/**
 * The decks, read out of the core package at build time — the same arrangement
 * as the model cards and the templates, and for the same reason: the window
 * keeps no Node dependency and the browser preview behaves like the app.
 */
const files = import.meta.glob('../../../packages/core/src/vary/builtin/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const decks: Deck[] = parseDecks(
  Object.entries(files).map(([path, text]) => ({
    source: path.slice(path.lastIndexOf('/') + 1),
    text,
  })),
);
