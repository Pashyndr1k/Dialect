/**
 * What a vision model is asked to report about a reference.
 *
 * Shaped to the IR rather than to the picture: every field here has somewhere
 * to land. Asking for things the IR cannot hold wastes output tokens and
 * invites the model to invent structure of its own.
 */

import { z } from 'zod';

/** Bumped whenever this schema or the extraction prompt changes. */
export const EXTRACTION_VERSION = '1';

export const ExtractedEntity = z.object({
  name: z.string().describe('short noun phrase naming this subject'),
  type: z.enum(['person', 'product', 'creature', 'object']),
  description: z
    .string()
    .describe('detailed appearance: build, wardrobe, materials, props, wear and texture'),
});

export const ExtractedScene = z.object({
  headline: z
    .string()
    .describe('one short noun phrase naming who or what is in frame, and where'),
  entities: z.array(ExtractedEntity),
  action: z.string().describe('what is happening, as one action'),

  location: z.string().describe('where this is, in a short phrase'),
  locationDescription: z.string().describe('the environment in detail, in depth layers'),
  timeOfDay: z.string(),
  era: z.string().describe('period, or "contemporary"'),

  shotSize: z.enum([
    'extreme-wide', 'wide', 'medium-wide', 'medium',
    'medium-close', 'close-up', 'extreme-close-up', 'two-shot', 'over-shoulder',
  ]),
  angle: z.string().describe('camera height and orientation'),
  aspectRatio: z.string().describe('e.g. 16:9'),

  lightingKey: z.string().describe('the primary light source, named'),
  lightingSources: z.array(z.string()).describe('any further named sources'),
  contrast: z.string(),
  colorTemp: z.string(),

  opticsEffect: z
    .string()
    .describe('the visible depth-of-field result, e.g. "background melts into soft blur". Never a lens number.'),

  palette: z.array(z.string()).describe('dominant colours as hex'),
  grade: z.string().describe('e.g. muted, warm, high-contrast'),
  grain: z.enum(['none', 'fine-uniform', 'heavy']),

  medium: z.string().describe('photograph, film still, 3D render, illustration'),
  genre: z.string(),
  atmosphere: z.string().describe('mood, in physical terms rather than emotion labels'),

  textInImage: z
    .array(z.object({ exact: z.string(), placement: z.string() }))
    .describe('any words visible in the image, transcribed exactly. Empty if none.'),
});

export type ExtractedScene = z.infer<typeof ExtractedScene>;
