import { parseRegistry, type Registry } from '@dialect/core';

/**
 * Model cards are read out of the core package at build time rather than over
 * the filesystem, so the window has no Node dependency and the browser preview
 * behaves exactly like the packaged app.
 */
const cards = import.meta.glob('../../../packages/core/src/registry/models/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const registry: Registry = parseRegistry(
  Object.entries(cards).map(([path, text]) => ({
    source: path.slice(path.lastIndexOf('/') + 1),
    text,
  })),
);

export const profiles = [...registry.profiles.values()].sort((a, b) => {
  if (a.family !== b.family) return a.family.localeCompare(b.family);
  return a.label.localeCompare(b.label);
});
