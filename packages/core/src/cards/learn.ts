/**
 * A model card, read out of the model's own prompting guide.
 *
 * Writing one by hand meant knowing the card format, the six syntaxes, the
 * three renderers, the whole IR path vocabulary and which engine rules exist —
 * which is a working knowledge of this codebase, held by roughly one person.
 * Everyone else has the thing that actually describes the model: the vendor's
 * prompting guide, which says what the fields are, in what order, what it
 * refuses, and how long a clip it will make.
 *
 * So the guide is the input. This asks for the card, in one structured answer,
 * and then checks it — because a card that references a field that does not
 * exist renders nothing, silently, for ever.
 *
 * It does not save anything. What comes back is a proposal, shown for reading
 * before it becomes a file: the guide may be out of date, may describe three
 * models at once, or may not be a prompting guide at all.
 */

import * as z from 'zod';

import type { Gateway } from '../providers/gateway.ts';
import type { ProviderUsage } from '../providers/types.ts';
import type { ModelProfile } from '../registry/types.ts';
import { isReadablePath, vocabularyText } from '../ir/vocabulary.ts';
import { RULES_BY_ID } from '../rules/index.ts';
import { RENDERERS } from '../renderers/index.ts';

/** Bumped whenever this schema or the instruction changes. Part of the cache key. */
export const CARD_LEARN_VERSION = 'card-learn-1';

/**
 * The shape asked for.
 *
 * Deliberately flatter than `ModelProfile`. Structured output is more reliable
 * against a shallow schema with described leaves than against nested optionals,
 * and `defaults` in particular is a free-form map in the card format, which is
 * exactly what a structured answer is worst at — so it is asked for as a list
 * of pairs and folded back into a map here.
 */
export const LearnedCard = z.object({
  id: z
    .string()
    .describe('Lower-case kebab-case id, e.g. kling-3-omni. Include the version if the guide names one.'),
  label: z.string().describe('The model as a person would write it, e.g. "Kling 3.0 Omni".'),
  vendor: z.string().describe('Who makes it, lower case, e.g. kuaishou. Empty if the guide does not say.'),
  family: z
    .enum(['image', 'video', 'audio', 'pipeline'])
    .describe('What it makes. "pipeline" only for a workflow tool such as ComfyUI.'),
  syntax: z
    .enum(['field-list', 'shot-description', 'natural', 'comma-phrases', 'tag-list', 'graph'])
    .describe(
      'The form the guide asks for. field-list: labelled fields in a mandatory order. ' +
        'shot-description: one paragraph of directed prose. natural: plain description. ' +
        'comma-phrases: comma-separated phrases and flags. tag-list: bare tags.',
    ),
  renderer: z
    .enum(['field-list', 'shot-description', 'natural'])
    .describe('Which renderer builds it. Pick the closest of the three: this build has no others.'),
  header: z.string().describe('Title line for a saved prompt, e.g. "Kling 3.0 prompt".'),
  routingNote: z
    .string()
    .describe('One sentence: when to reach for this model rather than another. Say what it is unusually good at.'),
  bestFor: z
    .array(z.string())
    .describe(
      'Job labels, lower_snake_case, e.g. product_shot, character_continuity, image_edit, ' +
        'cinematic_still, physics, dialogue. Three to six. Empty if the guide gives no basis.',
    ),

  fields: z
    .array(
      z.object({
        name: z.string().describe('The field name exactly as the guide writes it.'),
        from: z.array(z.string()).describe('IR paths feeding it, in reading order. Only paths from the list given.'),
        join: z.string().describe('What separates the parts. Empty for the default ", ".'),
        mode: z.enum(['join', 'first']).describe('join concatenates every source; first takes the first that yields anything.'),
        fallback: z.string().describe('Used when nothing resolves. Empty to leave the field out instead.'),
        negative: z.boolean().describe('True only for a field that carries what to avoid.'),
      }),
    )
    .describe(
      'Only for syntax field-list, and then the mandatory order exactly as the guide states it. ' +
        'Empty for every other syntax — prose is composed, not filled in.',
    ),

  fieldOrder: z
    .array(z.string())
    .describe('For shot-description: the order the guide says the prose should cover. Empty otherwise.'),

  separator: z.string().describe('What goes between fields. "\\n" for one per line, ", " for one line. Empty for the default.'),
  labelled: z.boolean().describe('True if each field is printed with its name. False for one unlabelled run of text.'),

  durationS: z.number().describe('Longest clip it will generate, in seconds. 0 if not applicable or not stated.'),
  maxChars: z.number().describe('Prompt length limit in characters. 0 if not stated.'),
  maxReferences: z.number().describe('How many reference files may be attached at once. 0 if not stated.'),
  maxRes: z.string().describe('Highest resolution, as the guide writes it, e.g. "4K". Empty if not stated.'),

  negativePrompt: z.boolean().describe('Whether it has a dedicated negative field or flag.'),
  nativeAudio: z.boolean().describe('Whether it generates picture and sound in one pass.'),
  lipSync: z.boolean().describe('Whether it syncs mouths to dialogue.'),
  startEndFrame: z.boolean().describe('Whether it takes a start and an end frame.'),
  tokenWeights: z.boolean().describe('Whether it reads weighting syntax such as (word:1.2).'),
  emitsGearNumbers: z
    .boolean()
    .describe('Whether the guide asks for focal lengths and apertures. False unless it says so plainly — most models ignore them.'),
  refSyntax: z.string().describe('How a reference is named inside the prompt, e.g. "@image{n}". Empty if it has none.'),

  rules: z
    .array(z.string())
    .describe('Ids from the rule list given. Only rules the guide actually supports. Empty is a fine answer.'),
  defaults: z
    .array(
      z.object({
        path: z.string().describe('An IR path from the list given.'),
        value: z.string().describe('The value to force. Write true/false for a flag, digits for a number.'),
      }),
    )
    .describe('Values this model always wants, e.g. sound.music false where it cannot make music. Usually empty.'),

  sourceName: z.string().describe('The guide, as it titles itself.'),
  sourceDated: z.string().describe('The guide date as YYYY-MM-DD, or its year and month. Empty if undated.'),

  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('How much of this the guide actually stated, as against being inferred from the general shape of such models.'),
  notes: z
    .array(z.string())
    .describe('What the guide did not say, what was assumed, and anything that looked contradictory. Say it plainly; this is read.'),
});

export type LearnedCard = z.infer<typeof LearnedCard>;

const SYSTEM = `You read a generative model's official prompting guide and write
the model's card for a prompt compiler.

The compiler holds one model-independent document — the IR — and each model has
a card saying how that document becomes that model's own prompt. Your job is the
card, and only what the guide supports.

Two things matter more than completeness.

First, a field may only read IR paths from the list below. A path that is not on
the list produces nothing at render time and says nothing about why, so a card
that invents one is worse than a card that leaves the field out. If the guide
asks for something the IR has no path for, leave that field out and say so in
notes.

Second, say what you do not know. A guide that never mentions a duration limit
is not a guide saying there is none. Leave the number 0, and write the gap into
notes. Someone reads these.

On syntax: pick the form the guide asks for, then pick the closest renderer of
the three that exist. comma-phrases and tag-list have no renderer of their own —
render them as natural, and note it. Only fill \`fields\` for a field-list model,
where the guide gives an explicit named order; prose models compose, and a list
of fields for one of those is a list nothing reads.`;

export interface CardLearnOptions {
  /** Where the guide was fetched from. Recorded on the card. */
  url: string;
  /** The guide as text. */
  guide: string;
}

export interface CardLearnResult {
  profile: ModelProfile;
  /** What the model said about its own confidence, and what it had to assume. */
  confidence: LearnedCard['confidence'];
  notes: string[];
  /** Paths and rules that were asked for and are not real. Dropped, and listed. */
  dropped: string[];
  usage: ProviderUsage;
  cached: boolean;
}

/** Longest stretch of guide sent. Past this it is navigation and footers. */
const MAX_GUIDE_CHARS = 120_000;

const clean = (s: string): string => s.trim();
const some = (s: string): string | undefined => (clean(s) ? clean(s) : undefined);

/**
 * A written value back into what the card format wants.
 *
 * The model answers in strings because a structured answer with a genuinely
 * free-form value type is a structured answer that fails half the time.
 */
function typed(value: string): unknown {
  const t = value.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

/**
 * The answer as a card, with everything unreal taken out.
 *
 * Exported and pure, so the checking can be tested without spending anything —
 * which matters, because the checking is the part that decides whether a card
 * renders or quietly does nothing.
 */
export function cardFrom(
  answer: LearnedCard,
  options: CardLearnOptions,
): { profile: ModelProfile; dropped: string[] } {
  const dropped: string[] = [];

  const fields = answer.fields
    .map((f) => {
      const from = f.from.filter((p) => {
        if (isReadablePath(p)) return true;
        dropped.push(`${f.name}: no IR path "${p}"`);
        return false;
      });
      return { ...f, from };
    })
    // A field with nothing left to read is not a field; keeping it would print
    // its fallback for ever and look like a working card.
    .filter((f) => {
      if (f.from.length > 0 || some(f.fallback)) return true;
      dropped.push(`${f.name}: nothing left for it to read`);
      return false;
    })
    .map((f) => ({
      name: f.name,
      from: f.from,
      ...(some(f.join) ? { join: f.join } : {}),
      ...(f.mode === 'first' ? { mode: 'first' as const } : {}),
      ...(some(f.fallback) ? { fallback: f.fallback } : {}),
      ...(f.negative ? { role: 'negative' as const } : {}),
    }));

  const rules = answer.rules.filter((id) => {
    if (RULES_BY_ID.has(id)) return true;
    dropped.push(`no engine rule "${id}"`);
    return false;
  });

  const defaults: Record<string, unknown> = {};
  for (const d of answer.defaults) {
    if (!isReadablePath(d.path)) {
      dropped.push(`default: no IR path "${d.path}"`);
      continue;
    }
    defaults[d.path] = typed(d.value);
  }

  const renderer = RENDERERS[answer.renderer] ? answer.renderer : 'natural';
  if (renderer !== answer.renderer) dropped.push(`no renderer "${answer.renderer}"; using natural`);

  const limits = {
    ...(answer.durationS > 0 ? { durationS: answer.durationS } : {}),
    ...(answer.maxChars > 0 ? { maxChars: answer.maxChars } : {}),
    ...(answer.maxReferences > 0 ? { references: answer.maxReferences } : {}),
    ...(some(answer.maxRes) ? { maxRes: clean(answer.maxRes) } : {}),
  };

  const supports = {
    negativePrompt: answer.negativePrompt,
    ...(answer.nativeAudio ? { nativeAudio: true } : {}),
    ...(answer.lipSync ? { lipSync: true } : {}),
    ...(answer.startEndFrame ? { startEndFrame: true } : {}),
    ...(answer.tokenWeights ? { tokenWeights: true } : {}),
    emitsGearNumbers: answer.emitsGearNumbers,
    ...(some(answer.refSyntax) ? { refSyntax: clean(answer.refSyntax) } : {}),
  };

  const profile: ModelProfile = {
    id: clean(answer.id),
    label: clean(answer.label),
    ...(some(answer.vendor) ? { vendor: clean(answer.vendor) } : {}),
    family: answer.family,
    syntax: answer.syntax,
    renderer,
    ...(some(answer.header) ? { header: clean(answer.header) } : {}),
    ...(answer.bestFor.length > 0 ? { bestFor: answer.bestFor.map(clean) } : {}),
    ...(some(answer.routingNote) ? { routingNote: clean(answer.routingNote) } : {}),
    ...(fields.length > 0 ? { fields } : {}),
    ...(answer.fieldOrder.length > 0 ? { fieldOrder: answer.fieldOrder.map(clean) } : {}),
    ...(some(answer.separator) || answer.labelled === false
      ? {
          assembly: {
            ...(some(answer.separator) ? { separator: answer.separator.replace(/\\n/g, '\n') } : {}),
            labelled: answer.labelled,
          },
        }
      : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
    supports,
    ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
    ...(rules.length > 0 ? { rules } : {}),
    source: {
      // The guide's own title where it has one, and the address either way —
      // a card that cannot say where it came from cannot be checked later.
      name: some(answer.sourceName) ? `${clean(answer.sourceName)} — ${options.url}` : options.url,
      dated: some(answer.sourceDated) ?? new Date().toISOString().slice(0, 10),
    },
  };

  return { profile, dropped };
}

/** Read a guide and propose a card. Costs one call, and is cached by its text. */
export async function learnCard(gateway: Gateway, options: CardLearnOptions): Promise<CardLearnResult> {
  const guide = options.guide.trim();
  if (guide.length < 200) {
    throw new Error(
      'There is almost nothing at that address to read — ' +
        `${guide.length} characters. Check the link points at the guide itself rather than a page that loads one.`,
    );
  }

  // Always-on rules are left off the list. They run for every card regardless,
  // so offering them is offering a choice that does not exist.
  const ruleList = [...RULES_BY_ID.values()]
    .filter((r) => !r.alwaysOn)
    .map((r) => `  ${r.id} — ${r.rationale.split(/(?<=\.)\s/)[0]}`)
    .join('\n');

  const result = await gateway.extract({
    system: `${SYSTEM}\n\n${vocabularyText()}\n\nEngine rules a card may name:\n${ruleList}`,
    instruction: [
      `Prompting guide fetched from ${options.url}.`,
      '',
      guide.slice(0, MAX_GUIDE_CHARS),
      '',
      'Write the card for the model this guide is about. If it covers several',
      'models, take the one it is chiefly about and name the others in notes.',
    ].join('\n'),
    schema: LearnedCard,
    schemaVersion: CARD_LEARN_VERSION,
  });

  const { profile, dropped } = cardFrom(result.value, options);

  return {
    profile,
    confidence: result.value.confidence,
    notes: result.value.notes,
    dropped,
    usage: result.usage,
    cached: result.cached,
  };
}
