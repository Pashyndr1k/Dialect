import { parseLibrary, templatesFor, type Library, type Modality } from '@dialect/core';

/**
 * The template library, read out of the core package at build time — the same
 * arrangement as the model cards, and for the same reason: the window keeps no
 * Node dependency, so the browser preview behaves exactly like the packaged app.
 */
const read = (glob: Record<string, string>) =>
  Object.entries(glob).map(([path, text]) => ({
    source: path.slice(path.lastIndexOf('/') + 1),
    text,
  }));

// The options have to be written out at each call: Vite reads this glob at
// build time and will not follow a variable to find them.
export const templateLibrary: Library = parseLibrary(
  read(
    import.meta.glob('../../../packages/core/src/templates/builtin/templates/*.yaml', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ),
  read(
    import.meta.glob('../../../packages/core/src/templates/builtin/snippets/*.yaml', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ),
);

/** Only the templates that make sense for what is being made. */
export const templatesForModality = (modality: Modality) =>
  templatesFor(templateLibrary, modality).sort((a, b) => a.name.localeCompare(b.name));
