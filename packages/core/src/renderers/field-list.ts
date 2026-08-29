/**
 * The `field-list` form: labelled fields in a mandatory order, nothing skipped.
 *
 * Kling is the reference implementation. The renderer never writes English — it
 * orders, labels and joins prose that already sits in the IR. That is what keeps
 * it deterministic, and what makes a batch of a thousand files cost nothing to
 * compose.
 */

import type { PromptIR } from '../ir/types.ts';
import type { ModelProfile } from '../registry/types.ts';
import type { RenderResult, Segment } from './types.ts';
import { RendererError, joinParts } from './types.ts';

const ID = 'field-list';

type FieldBuilder = (ir: PromptIR, profile: ModelProfile) => { text: string; from: string[] };

/** A field that does not apply gets a deliberate minimal value, never omission. */
const FALLBACK: Record<string, string> = {
  SceneDescription: 'minimal context',
  Atmosphere: 'neutral',
};

const BUILDERS: Record<string, FieldBuilder> = {
  Subject: (ir) => ({
    text: ir.subject?.headline ?? joinParts(ir.subject?.entities?.map((e) => e.name) ?? []),
    from: ['subject.headline', 'subject.entities[].name'],
  }),

  SubjectDescription: (ir) => ({
    // Descriptions are repeated in full, every time. Abbreviating them is what
    // breaks a character across separate generations.
    text: joinParts(
      (ir.subject?.entities ?? []).map((e) => e.description),
      ' ',
    ),
    from: ['subject.entities[].description'],
  }),

  Movement: (ir) => ({
    text: ir.subject?.action ?? '',
    from: ['subject.action'],
  }),

  Scene: (ir) => ({
    text: joinParts([ir.environment?.location, ir.environment?.timeOfDay]),
    from: ['environment.location', 'environment.timeOfDay'],
  }),

  SceneDescription: (ir) => ({
    text: ir.environment?.description ?? '',
    from: ['environment.description'],
  }),

  Camera: (ir, profile) => ({
    text: joinParts([
      ir.shot?.framing,
      ir.shot?.angle,
      cameraMovePhrase(ir),
      profile.supports?.emitsGearNumbers ? lensPhrase(ir) : undefined,
    ]),
    from: ['shot.framing', 'shot.angle', 'cameraMove', 'optics.gearHint'],
  }),

  Lighting: (ir) => ({
    text: joinParts([
      ir.lighting?.key,
      ...(ir.lighting?.sources ?? []),
      ir.lighting?.contrast,
      ir.lighting?.colorTemp,
      ir.lighting?.quality,
      ir.lighting?.direction,
      ...(ir.lighting?.lookWords ?? []),
    ]),
    from: ['lighting'],
  }),

  Atmosphere: (ir) => ({
    text: joinParts([ir.mood?.atmosphere, ir.mood?.emotion, ir.mood?.energy]),
    from: ['mood'],
  }),

  Negative: (ir) => ({
    text: joinParts(ir.constraints?.avoid ?? []),
    from: ['constraints.avoid'],
  }),
};

function cameraMovePhrase(ir: PromptIR): string | undefined {
  const cm = ir.cameraMove;
  if (!cm) return undefined;
  // Moves read hyphenated in cinematography: push-in, dolly-zoom, whip-pan.
  const move = cm.move;
  return cm.speed && cm.speed !== 'medium' ? `${cm.speed} ${move}` : move;
}

function lensPhrase(ir: PromptIR): string | undefined {
  const hint = ir.optics?.gearHint;
  if (!hint) return undefined;
  return /lens$/i.test(hint) ? hint : `${hint} lens`;
}

export function renderFieldList(ir: PromptIR, profile: ModelProfile): RenderResult {
  const order = profile.fieldOrder;
  if (!order || order.length === 0) {
    throw new RendererError(ID, `profile "${profile.id}" has no fieldOrder, so there is nothing to order`);
  }

  const segments: Segment[] = [];
  let negative: string | undefined;

  for (const field of order) {
    const build = BUILDERS[field];
    if (!build) {
      throw new RendererError(
        ID,
        `profile "${profile.id}" asks for a field named "${field}", which this renderer does not know how to build. ` +
          `Known fields: ${Object.keys(BUILDERS).join(', ')}.`,
      );
    }
    const { text, from } = build(ir, profile);
    const value = text.trim() || (FALLBACK[field] ?? '');

    if (field === 'Negative') {
      // Negative travels separately so the UI can show it in its own panel.
      if (value) negative = value;
      continue;
    }
    segments.push({ label: field, from, text: value, source: 'ir' });
  }

  const text = segments.map((s) => `${s.label}: ${s.text}`).join('\n\n');

  const params: Record<string, string> = {};
  if (ir.shot?.aspectRatio) params['aspect_ratio'] = ir.shot.aspectRatio;
  if (ir.shot?.durationS !== undefined) {
    params['duration'] = `${ir.shot.durationS} ${ir.shot.durationS === 1 ? 'second' : 'seconds'}`;
  }

  return negative === undefined
    ? { target: profile.id, segments, text, params }
    : { target: profile.id, segments, text, negative, params };
}
