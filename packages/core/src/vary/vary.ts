/**
 * Asking for many at once, and putting each back onto the document.
 */

import { z } from 'zod';

import type { Gateway } from '../providers/gateway.ts';
import type { ProviderUsage } from '../providers/types.ts';
import type { PromptIR } from '../ir/types.ts';
import { CAMERA_MOVES, SHOT_SIZES } from '../ir/types.ts';
import { setPath } from '../ir/paths.ts';
import { AXIS_BRIEF, AXIS_FIELDS, MAX_VARIANTS, type VaryAxis, type VaryOptions } from './types.ts';

/** Bumped whenever a schema or the prompt below changes. */
export const VARY_VERSION = '1';

const labelled = {
  label: z.string().describe('two or three words naming this one, for a list'),
};

/**
 * One shape per axis, and each is small on purpose.
 *
 * A variant is a difference, not a document: everything it does not mention is
 * already decided, so asking for a full description twenty times over would buy
 * the same two hundred words twenty times and make them harder to tell apart.
 */
const SHAPES = {
  subject: z.object({
    ...labelled,
    headline: z.string().describe('a short noun phrase: who or what, and where in frame'),
    description: z
      .string()
      .describe('the detail that makes this one itself — build, wear, marks, wear on the wear'),
    action: z.string().describe('one thing they do, or empty for a still that holds'),
  }),
  look: z.object({
    ...labelled,
    medium: z.string().describe('what it is made of: film stock, render, paint, print'),
    grade: z.string().describe('how the colour sits'),
    lightingKey: z.string().describe('the named source, not the mood'),
    grain: z.string().describe('none, fine-uniform or heavy — or empty'),
  }),
  mood: z.object({
    ...labelled,
    atmosphere: z.string().describe('what a camera would record: dust, breath, stillness'),
    emotion: z.string().describe('a phrase, not a label'),
  }),
  framing: z.object({
    ...labelled,
    shotSize: z.string().describe(`one of: ${SHOT_SIZES.join(', ')}`),
    angle: z.string().describe('where the camera is, in words'),
  }),
  moment: z.object({
    ...labelled,
    action: z.string().describe('one thing that happens'),
    cameraMove: z.string().describe(`one of: ${CAMERA_MOVES.join(', ')}`),
    cameraSpeed: z.string().describe('slow, medium or fast'),
  }),
} as const;

export type Variant<A extends VaryAxis = VaryAxis> = z.infer<(typeof SHAPES)[A]>;

export const VARY_SYSTEM = `You are given one description and asked for several
versions of it that differ along a single named axis.

Everything off that axis is already decided and is not yours to touch. A
variation of the light does not move the subject; a variation of the subject
does not repaint the room. If you find yourself changing something the axis does
not name, you have stopped varying and started rewriting.

They must differ from each other, and that is the whole task. Three that are the
same idea in different words are worth less than one. Spread them: if one is the
obvious answer, the next should be the one nobody reaches for. Do not build a
gradient — a slightly darker version of the last is not a version.

Each stays as usable as the original. A variation nobody would choose is not
range, it is filler; every one of them should be worth making.

Describe what a camera would record, keep to what is asked for, and avoid words
that only assert quality.`;

export interface VaryResult<A extends VaryAxis = VaryAxis> {
  variants: Array<Variant<A>>;
  usage: ProviderUsage;
  cached: boolean;
  key: string;
}

/** What the document already says on this axis, so the variants avoid it. */
function standing(ir: PromptIR, axis: VaryAxis): string[] {
  const say = (label: string, value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? `${label}: ${value.trim()}` : undefined;

  const lines: Array<string | undefined> = [];
  if (axis === 'subject') {
    lines.push(say('Subject', ir.subject?.headline), say('Action', ir.subject?.action));
    for (const e of ir.subject?.entities ?? []) lines.push(say('Who', e.description));
  } else if (axis === 'look') {
    lines.push(
      say('Medium', ir.style?.medium),
      say('Grade', ir.palette?.grade),
      say('Key light', ir.lighting?.key),
    );
  } else if (axis === 'mood') {
    lines.push(say('Atmosphere', ir.mood?.atmosphere), say('Feeling', ir.mood?.emotion));
  } else if (axis === 'framing') {
    lines.push(say('Size', ir.shot?.size), say('Angle', ir.shot?.angle));
  } else {
    lines.push(say('Action', ir.subject?.action), say('Camera', ir.cameraMove?.move));
  }

  return lines.filter((l): l is string => l !== undefined);
}

/** The whole document, briefly, so a variant knows what it is a variant of. */
function context(ir: PromptIR): string[] {
  const parts = [
    ir.subject?.headline,
    ir.subject?.action,
    ir.environment?.location,
    ir.lighting?.key,
    ir.style?.medium,
    ir.style?.genre,
  ].filter((p): p is string => Boolean(p?.trim()));

  return parts.length > 0 ? [`It is: ${parts.join('. ')}.`] : [];
}

export function varyInstruction(ir: PromptIR, options: VaryOptions): string {
  const held = standing(ir, options.axis);

  return [
    `Give ${options.count} versions that differ in ${AXIS_BRIEF[options.axis]}`,
    '',
    ...context(ir),
    held.length > 0
      ? `\nWhat it says now on that axis — none of your versions should be this one:\n${held.join('\n')}`
      : '',
    options.brief ? `\nStay within this: ${options.brief.trim()}` : '',
    options.nudge
      ? `\nOne thing must be true of all of them — "${options.nudge.name}": ` +
        `${options.nudge.text.trim()} Make it structural, not a detail dropped in at the edge.`
      : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export class NothingToVaryError extends Error {
  constructor() {
    super('Nothing to vary: make a prompt first.');
    this.name = 'NothingToVaryError';
  }
}

export async function vary<A extends VaryAxis>(
  gateway: Gateway,
  ir: PromptIR,
  options: VaryOptions & { axis: A },
): Promise<VaryResult<A>> {
  if (!ir.subject?.headline && !ir.audio?.genre) throw new NothingToVaryError();

  const count = Math.max(2, Math.min(MAX_VARIANTS, Math.round(options.count)));
  const schema = z.object({ variants: z.array(SHAPES[options.axis]) });

  const result = await gateway.extract({
    system: VARY_SYSTEM,
    instruction: varyInstruction(ir, { ...options, count }),
    schema,
    // The nudge is part of the question, so a run with one must not be handed
    // an answer bought without it.
    schemaVersion: `${VARY_VERSION}:${options.axis}:${count}${options.nudge ? `:${options.nudge.id}` : ''}`,
  });

  return {
    variants: result.value.variants as Array<Variant<A>>,
    usage: result.usage,
    cached: result.cached,
    key: result.key,
  };
}

// ---------------------------------------------------------------------------
// Putting one back
// ---------------------------------------------------------------------------

const GRAINS = ['none', 'fine-uniform', 'heavy'];
const SPEEDS = ['slow', 'medium', 'fast'];

const pick = (value: string | undefined, allowed: readonly string[]): string | undefined =>
  value && allowed.includes(value) ? value : undefined;

/**
 * The variant laid onto the document it varies.
 *
 * Only the axis is written. A value the IR takes from a fixed set is dropped
 * when it is not one of them, rather than written and read back as nonsense.
 */
export function applyVariant(ir: PromptIR, axis: VaryAxis, variant: Variant): PromptIR {
  const v = variant as Record<string, string | undefined>;
  const set = (base: PromptIR, path: string, value: string | undefined): PromptIR =>
    value?.trim() ? setPath(base, path, value.trim()) : base;

  const label = v['label']?.trim() || ir.title;
  let next: PromptIR = { ...ir, ...(label ? { title: label } : {}) };

  if (axis === 'subject') {
    next = set(next, 'subject.headline', v['headline']);
    next = set(next, 'subject.action', v['action']);
    // The description belongs to whoever is being varied, so it replaces the
    // first entity rather than being added as another person in the frame.
    if (v['description']?.trim()) {
      const entities = ir.subject?.entities ?? [];
      const first = entities[0] ?? { id: 'e1', name: v['headline'] ?? 'the subject' };
      next = setPath(next, 'subject.entities', [
        { ...first, description: v['description'].trim() },
        ...entities.slice(1),
      ]);
    }
    return next;
  }

  if (axis === 'look') {
    next = set(next, 'style.medium', v['medium']);
    next = set(next, 'palette.grade', v['grade']);
    next = set(next, 'lighting.key', v['lightingKey']);
    return set(next, 'texture.grain', pick(v['grain'], GRAINS));
  }

  if (axis === 'mood') {
    next = set(next, 'mood.atmosphere', v['atmosphere']);
    return set(next, 'mood.emotion', v['emotion']);
  }

  if (axis === 'framing') {
    next = set(next, 'shot.size', pick(v['shotSize'], SHOT_SIZES));
    return set(next, 'shot.angle', v['angle']);
  }

  next = set(next, 'subject.action', v['action']);
  const move = pick(v['cameraMove'], CAMERA_MOVES);
  return move
    ? setPath(next, 'cameraMove', {
        move,
        speed: pick(v['cameraSpeed'], SPEEDS) ?? 'slow',
      })
    : next;
}

/** Who was responsible for what, the same way a bundle records it. */
export const variedProvenance = (axis: VaryAxis, label: string) => [
  { ref: `varied: ${label}`, fields: AXIS_FIELDS[axis] },
];
