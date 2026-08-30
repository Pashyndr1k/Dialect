/**
 * Reference image to Prompt IR.
 *
 * The vision model fills a flat, well-described shape; this module maps that
 * onto the IR and records where every field came from. Nothing here writes
 * prose of its own — that is the extractor's job — and nothing here calls a
 * model directly, which is what keeps it testable.
 */

import type { Gateway } from '../providers/gateway.ts';
import type { ImagePart, ProviderUsage } from '../providers/types.ts';
import type { Modality, PromptIR } from '../ir/types.ts';
import { IR_VERSION } from '../ir/types.ts';
import { EXTRACTION_VERSION, ExtractedScene } from './schema.ts';
import {
  EXTRACTION_INSTRUCTION,
  EXTRACTION_INSTRUCTION_MANY,
  EXTRACTION_SYSTEM,
  notedInstruction,
} from './prompt.ts';

export interface ExtractOptions {
  /** Label recorded in provenance, normally the file name. */
  reference: string;
  /** What the resulting IR is for. Defaults to a still. */
  modality?: Modality;
  /**
   * What the person said alongside the reference.
   *
   * Not a second reference and not a separate call: one reading, of a picture
   * and a sentence together, because a document assembled from two answers
   * agrees with neither.
   */
  note?: string;
}

export interface ExtractResult {
  ir: PromptIR;
  scene: ExtractedScene;
  usage: ProviderUsage;
  cached: boolean;
  /** The cache key this answer is filed under. */
  key: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

export function sceneToIR(
  scene: ExtractedScene,
  options: ExtractOptions,
): PromptIR {
  const modality = options.modality ?? 'image';

  const ir: PromptIR = {
    irVersion: IR_VERSION,
    modality,
    mode: 'generate',
    subject: {
      ...(nonEmpty(scene.headline) ? { headline: scene.headline } : {}),
      entities: scene.entities.map((e, i) => ({
        id: `e${i + 1}`,
        type: e.type,
        name: e.name,
        description: e.description,
      })),
      ...(nonEmpty(scene.action) ? { action: scene.action } : {}),
    },
    environment: {
      ...(nonEmpty(scene.location) ? { location: scene.location } : {}),
      ...(nonEmpty(scene.locationDescription)
        ? { description: scene.locationDescription }
        : {}),
      ...(nonEmpty(scene.timeOfDay) ? { timeOfDay: scene.timeOfDay } : {}),
      ...(nonEmpty(scene.era) ? { era: scene.era } : {}),
    },
    shot: {
      // Absent rather than empty. A reading always names a size, but a template
      // learned from an example that never framed anything does not.
      ...(nonEmpty(scene.shotSize) ? { size: scene.shotSize } : {}),
      ...(nonEmpty(scene.angle) ? { angle: scene.angle } : {}),
      ...(nonEmpty(scene.aspectRatio) ? { aspectRatio: scene.aspectRatio } : {}),
    },
    lighting: {
      ...(nonEmpty(scene.lightingKey) ? { key: scene.lightingKey } : {}),
      sources: scene.lightingSources.filter((s) => s.trim().length > 0),
      ...(nonEmpty(scene.contrast) ? { contrast: scene.contrast } : {}),
      ...(nonEmpty(scene.colorTemp) ? { colorTemp: scene.colorTemp } : {}),
    },
    // No gearHint: a lens number cannot be read off an image, and the rules
    // would strip an invented one anyway.
    optics: nonEmpty(scene.opticsEffect) ? { effect: scene.opticsEffect } : {},
    palette: {
      dominant: scene.palette,
      ...(nonEmpty(scene.grade) ? { grade: scene.grade } : {}),
    },
    texture: nonEmpty(scene.grain) ? { grain: scene.grain } : {},
    style: {
      ...(nonEmpty(scene.medium) ? { medium: scene.medium } : {}),
      ...(nonEmpty(scene.genre) ? { genre: scene.genre } : {}),
    },
    mood: nonEmpty(scene.atmosphere) ? { atmosphere: scene.atmosphere } : {},
    provenance: [
      {
        ref: options.reference,
        fields: ['subject', 'environment', 'shot', 'lighting', 'optics', 'palette', 'style', 'mood'],
      },
    ],
  };

  const text = scene.textInImage.filter((t) => t.exact.trim().length > 0);
  if (text.length > 0) ir.textInImage = text;

  return ir;
}

/**
 * Several stills at once, read as one scene.
 *
 * A style reference and a character reference are two pictures of one intention,
 * and the only way to get a document that honours both is to show them together
 * — two readings merged afterwards would each be internally consistent and
 * disagree with each other.
 */
export async function extractFromImages(
  gateway: Gateway,
  images: ImagePart[],
  options: ExtractOptions,
): Promise<ExtractResult> {
  if (images.length === 0) {
    throw new Error('No reference to read: nothing was attached.');
  }

  const base = images.length > 1 ? EXTRACTION_INSTRUCTION_MANY : EXTRACTION_INSTRUCTION;

  const result = await gateway.extract({
    system: EXTRACTION_SYSTEM,
    instruction: options.note?.trim() ? notedInstruction(base, options.note) : base,
    images,
    schema: ExtractedScene,
    schemaVersion: EXTRACTION_VERSION,
  });

  return {
    ir: sceneToIR(result.value, options),
    scene: result.value,
    usage: result.usage,
    cached: result.cached,
    key: result.key,
  };
}

export const extractFromImage = (
  gateway: Gateway,
  image: ImagePart,
  options: ExtractOptions,
): Promise<ExtractResult> => extractFromImages(gateway, [image], options);
