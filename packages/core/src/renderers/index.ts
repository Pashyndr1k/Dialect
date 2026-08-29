import type { Renderer } from './types.ts';
import { renderFieldList } from './field-list.ts';
import { renderShotDescription } from './shot-description.ts';

/**
 * Renderers are written per dialect *form*, not per model. Several models share
 * one renderer whenever they share a shape, and the differences between them
 * live in their profile cards.
 */
export const RENDERERS: Record<string, Renderer> = {
  'field-list': renderFieldList,
  'shot-description': renderShotDescription,
};

export class UnknownRendererError extends Error {
  constructor(profileId: string, rendererId: string) {
    super(
      `Profile "${profileId}" asks for renderer "${rendererId}", which this build does not have. ` +
        `Known renderers: ${Object.keys(RENDERERS).join(', ')}.`,
    );
    this.name = 'UnknownRendererError';
  }
}

export * from './types.ts';
export * from './document.ts';
export { renderFieldList, renderShotDescription };
