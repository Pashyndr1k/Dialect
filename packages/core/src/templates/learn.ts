/**
 * Learning a template from a prompt that already works.
 *
 * Someone has a prompt they trust. They want fifty more like it, each about a
 * different character, and they do not want to write the other forty-nine.
 *
 * The job is not to improve their prompt. It is to find its seams: which parts
 * describe *this particular* subject, and which parts describe *how the thing
 * is made*. The second kind is why the prompt works and has to survive word for
 * word; the first kind becomes a hole someone fills with a few words.
 *
 * Getting that split right is the whole of it. Turn too much into holes and the
 * template stops carrying what made the example good. Turn too little and it
 * only ever makes the same picture again.
 */

import { z } from 'zod';
import { stringify as toYaml } from 'yaml';

import type { Gateway } from '../providers/gateway.ts';
import type { ProviderUsage } from '../providers/types.ts';
import type { Modality, PromptIR } from '../ir/types.ts';
import { ExtractedScene } from '../extract/schema.ts';
import { sceneToIR } from '../extract/image.ts';
import { ExtractedShot, shotToIR } from '../extract/video.ts';
import type { IRFragment, Template, Variable } from './types.ts';
import { CAMERA_MOVES, SHOT_SIZES } from '../ir/types.ts';

const GRAINS = ['none', 'fine-uniform', 'heavy'] as const;
const SPEEDS = ['slow', 'medium', 'fast'] as const;

/**
 * Bumped whenever a schema or a prompt in this file changes.
 *
 * The schema itself is not in the cache key — only this is — so a shape change
 * that leaves the number alone would hand back an answer bought for the old one.
 * 2: the enum fields opened up, after the first live run failed on a grain the
 * model had no legal way to leave blank.
 * 3: somewhere to put the negatives, which the prompt already asked about and
 * the schema had no field for.
 */
export const LEARN_VERSION = '3';

/**
 * What the template makes, and what it starts from.
 *
 * The difference is structural rather than stylistic: an img2img template has a
 * source frame in it and describes a change, an img2vid template has a start
 * frame and describes motion. Those slots are set by the app rather than asked
 * for, so a template of a given kind is always the right shape.
 */
export const TEMPLATE_KINDS = ['text2img', 'img2img', 'text2vid', 'img2vid'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const KIND_LABEL: Record<TemplateKind, string> = {
  text2img: 'Text to image',
  img2img: 'Image to image',
  text2vid: 'Text to video',
  img2vid: 'Image to video',
};

export const modalityOfKind = (kind: TemplateKind): Modality =>
  kind === 'text2img' || kind === 'img2img' ? 'image' : 'video';

const startsFromAnImage = (kind: TemplateKind): boolean =>
  kind === 'img2img' || kind === 'img2vid';

/** How many people the template carries. Two is a scene; three is a crowd. */
export const CAST_SIZES = [0, 1, 2] as const;
export type CastSize = (typeof CAST_SIZES)[number];

const LearnedVariable = z.object({
  name: z
    .string()
    .describe('lower_snake_case, matching the {{name}} you wrote into the fields'),
  label: z.string().describe('what to call this box in a form — two or three words'),
  hint: z
    .string()
    .describe(
      'written as an instruction to the person filling it in, saying what good input looks ' +
        'like. Not a restatement of the label.',
    ),
  default: z
    .string()
    .describe('the value the example itself used, so the template can be tried as it stands'),
});

const learned = {
  name: z.string().describe('what to call this template — three or four words'),
  description: z.string().describe('one sentence: what it makes and when to reach for it'),
  variables: z
    .array(LearnedVariable)
    .describe('every {{hole}} you left, in the order someone should be asked for them'),
  /**
   * A reading has no use for this — a photograph has nothing it was asked to
   * avoid — but a working prompt very often ends in a list of them, and the
   * first live run put "No text, no watermark, no border" into the medium for
   * want of anywhere else. That reads as part of the style to every dialect,
   * instead of as the negatives it is.
   */
  avoid: z
    .array(z.string())
    .describe(
      'what the example says not to do — no text, no watermark, extra fingers. Each on its ' +
        'own, in the example\'s own words. Empty if it asks for nothing.',
    ),
};

/**
 * A template is not a reading, and forcing it through a reading's schema broke.
 *
 * A reading is of something that exists, so `grain` can be one of three named
 * values. A template is a description with holes in it: a field may hold
 * `{{a_placeholder}}`, or nothing at all where the example never mentioned it.
 * An enum can express neither, so the first live run of this prompt failed on a
 * grain the model had no legal way to leave blank.
 *
 * These fields are therefore strings here and are put back into their proper
 * shape on the way into the template, where anything unrecognised becomes
 * absent rather than a failure.
 */
const openEnums = {
  grain: z
    .string()
    .describe('none, fine-uniform or heavy — or empty if the example does not say'),
  shotSize: z.string().describe('the framing, or a {{placeholder}}, or empty'),
};

export const LearnedImageTemplate = ExtractedScene.extend({ ...learned, ...openEnums });
export const LearnedVideoTemplate = ExtractedShot.extend({
  ...learned,
  ...openEnums,
  cameraMove: z.string().describe('the one move, or empty if the example does not say'),
  cameraSpeed: z.string().describe('slow, medium or fast — or empty'),
});

export type LearnedImageTemplate = z.infer<typeof LearnedImageTemplate>;
export type LearnedVideoTemplate = z.infer<typeof LearnedVideoTemplate>;

/** At most this many holes. Someone with a few words is not filling a form. */
export const MAX_VARIABLES = 5;

export const LEARN_SYSTEM = `You are shown a prompt that already works, and you
are turning it into a template that will produce many more like it.

Do not improve it. It works; that is why it is here. Your job is to find its
seams, not to rewrite it.

Split it in two.

Everything describing *this particular subject* becomes a hole: write
{{lower_snake_case}} where it was, and declare it as a variable. Everything
describing *how the thing is made* — the rendering, the framing, the light, the
palette, the material language, the things to avoid — stays, word for word.
That fixed half is why the prompt works, and paraphrasing it is how a template
stops working.

Carry fixed wording over verbatim. Distinctive phrasing especially: if the
example says "wet-look specular highlights", the template says that, not
"shiny".

Use at most ${MAX_VARIABLES} variables, and prefer fewer, larger ones. The
person filling this in has a few words about their next character, not twenty
minutes and a questionnaire. One hole for who they are and one for what they
are wearing beats seven holes for eyes, hair, jaw, build, boots, cloak, scars.

Write each hint as an instruction to that person: what good input looks like,
with an example. Not a restatement of the label.

Give each variable the value the example itself used as its default, so the
template can be tried out as it stands and the split can be checked.

Where the example says nothing about a field, leave that field empty rather than
inventing something for it. A template that quietly adds a key light the example
never asked for is not the example's template.`;

export const CAST_NOTE: Record<CastSize, string> = {
  0: 'This template has no people in it. Leave the entity list empty.',
  1: 'This template carries exactly one character. Put a hole in their description, because who they are is the thing that changes.',
  2: 'This template carries exactly two characters, and they must stay distinguishable. Give each their own hole; do not describe them as a pair.',
};

export const KIND_NOTE: Record<TemplateKind, string> = {
  text2img: 'It makes an image from words alone.',
  img2img:
    'It starts from an image someone supplies and changes it. So the prompt is about the change, ' +
    'not about the whole picture: name what becomes different and let the rest be carried by the source.',
  text2vid: 'It makes a video from words alone: one action, one camera move.',
  img2vid:
    'It starts from an image someone supplies and moves it. The picture already fixes the room and ' +
    'the light, so the prompt is about the motion: one action, one camera move.',
};

export interface LearnOptions {
  kind: TemplateKind;
  cast: CastSize;
  /** Overrides the name the model proposes. */
  name?: string;
  /** The model the example was written for. Kept, so the template renders in it. */
  writtenFor?: string;
}

export interface LearnResult {
  template: Template;
  /** The template applied to its own defaults: the example, through itself. */
  preview: PromptIR;
  usage: ProviderUsage;
  cached: boolean;
  key: string;
}

export class EmptyExampleError extends Error {
  constructor() {
    super('Paste a prompt to learn from — a few lines at least.');
    this.name = 'EmptyExampleError';
  }
}

/** `A Game Character` becomes `a-game-character`, uniquely. */
export function templateId(name: string, taken: Iterable<string> = []): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'template';

  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/** Strips what belongs to a document rather than to a template. */
function fragmentOf(ir: PromptIR): IRFragment {
  const { irVersion: _v, provenance: _p, title: _t, ...rest } = ir;
  return rest as unknown as IRFragment;
}

/**
 * The open fields, back into the shapes the IR takes.
 *
 * A value the reading schema would have refused is dropped rather than carried:
 * a template whose grain is `{{grain}}` would put that string into every prompt
 * it ever made, which is worse than having no grain at all.
 */
function closedUp(answer: LearnedImageTemplate | LearnedVideoTemplate): unknown {
  const pick = <T extends string>(value: string, allowed: readonly T[]): T | '' =>
    (allowed as readonly string[]).includes(value) ? (value as T) : '';

  const video = answer as LearnedVideoTemplate;

  return {
    ...answer,
    grain: pick(answer.grain, GRAINS),
    shotSize: pick(answer.shotSize, SHOT_SIZES),
    ...(video.cameraMove === undefined
      ? {}
      : {
          // A shot has to have some move; unreadable becomes the honest one.
          cameraMove: pick(video.cameraMove, CAMERA_MOVES) || 'static',
          cameraSpeed: pick(video.cameraSpeed, SPEEDS) || 'slow',
        }),
  };
}

function variablesOf(declared: LearnedImageTemplate['variables']): Variable[] {
  return declared.slice(0, MAX_VARIABLES).map((v) => ({
    name: v.name,
    label: v.label,
    ...(v.hint.trim() ? { hint: v.hint } : {}),
    // A hole with no default cannot be filled by the app's own preview, so a
    // blank one is declared required rather than silently left undefined.
    ...(v.default.trim() ? { default: v.default } : { required: true }),
  }));
}

export function learnedToTemplate(
  answer: LearnedImageTemplate | LearnedVideoTemplate,
  options: LearnOptions,
  taken: Iterable<string> = [],
): Template {
  const modality = modalityOfKind(options.kind);
  const name = options.name?.trim() || answer.name;

  const ir =
    modality === 'video'
      ? shotToIR(closedUp(answer) as never, { reference: 'example' })
      : sceneToIR(closedUp(answer) as never, { reference: 'example', modality: 'image' });

  const fragment = fragmentOf(ir);

  // Negatives belong beside the document, not inside its style: a dialect with
  // a negative prompt puts them there, and one without says nothing at all.
  const avoid = (answer.avoid ?? []).map((a) => a.trim()).filter(Boolean);
  if (avoid.length > 0) fragment['constraints'] = { avoid };

  // The structural slots belong to the kind, not to the model's reading of the
  // example: a template that says it starts from an image must start from one.
  if (startsFromAnImage(options.kind)) {
    fragment['frames'] = { start: '{{source}}' };
  }
  if (options.kind === 'img2img') {
    fragment['mode'] = 'edit';
  }

  return {
    id: templateId(name, taken),
    name,
    description: answer.description,
    modality,
    ...(options.writtenFor ? { target: options.writtenFor } : {}),
    variables: [
      ...variablesOf(answer.variables),
      ...(startsFromAnImage(options.kind)
        ? [
            {
              name: 'source',
              label: 'Source image',
              hint: 'The picture this starts from — a file name or a reference id.',
              required: true,
            },
          ]
        : []),
    ],
    ir: fragment,
    source: {
      name: options.writtenFor
        ? `Learned from a prompt written for ${options.writtenFor}`
        : 'Learned from an example prompt',
      dated: new Date().toISOString().slice(0, 10),
    },
  };
}

export async function learnTemplate(
  gateway: Gateway,
  example: string,
  options: LearnOptions,
  taken: Iterable<string> = [],
): Promise<Omit<LearnResult, 'preview'>> {
  if (example.trim().length === 0) throw new EmptyExampleError();

  const modality = modalityOfKind(options.kind);
  const schema = modality === 'video' ? LearnedVideoTemplate : LearnedImageTemplate;

  const result = await gateway.extract({
    system: LEARN_SYSTEM,
    instruction: [
      KIND_NOTE[options.kind],
      CAST_NOTE[options.cast],
      '',
      'The prompt to learn from:',
      example.trim(),
    ].join('\n'),
    schema,
    // The kind and the cast change the question, so an answer bought for one
    // must not be handed back for another.
    schemaVersion: `${LEARN_VERSION}:${options.kind}:${options.cast}`,
  });

  return {
    template: learnedToTemplate(result.value, options, taken),
    usage: result.usage,
    cached: result.cached,
    key: result.key,
  };
}

/** A template as a file, ready to save beside the built-in ones. */
export function templateToYaml(template: Template): string {
  // Key order is chosen rather than inherited, because these get read and
  // edited by hand and the identifying fields belong at the top.
  const ordered: Record<string, unknown> = {
    id: template.id,
    name: template.name,
    ...(template.description ? { description: template.description } : {}),
    modality: template.modality,
    ...(template.target ? { target: template.target } : {}),
    ...(template.extends ? { extends: template.extends } : {}),
    ...(template.snippets?.length ? { snippets: template.snippets } : {}),
    ...(template.variables?.length ? { variables: template.variables } : {}),
    ir: template.ir,
    ...(template.source ? { source: template.source } : {}),
  };

  return toYaml(ordered, { lineWidth: 88 });
}
