/**
 * Writing one description from several.
 *
 * This is the second half of a deliberate split. Reading a reference is
 * expensive and answers a question that never changes — what is in this
 * picture. Combining that reading with what someone typed is cheap, answers a
 * question that changes every time a word does, and needs no pictures at all.
 *
 * Keeping them apart means editing the sentence beside a photograph costs a
 * text call rather than another look at the photograph, and it is the only way
 * to give each source a job. A single call shown a picture and a sentence can
 * be told to weigh them; it cannot be told that this picture is here for its
 * light and nothing else.
 */

import type { Gateway } from '../providers/gateway.ts';
import type { ProviderUsage } from '../providers/types.ts';
import type { PromptIR, ProvenanceEntry } from '../ir/types.ts';
import { ExtractedScene } from '../extract/schema.ts';
import { sceneToIR } from '../extract/image.ts';
import { ExtractedShot, shotToIR } from '../extract/video.ts';
import { ImaginedSong, imaginedToIR } from '../extract/idea.ts';
import { applyTemplate } from '../templates/apply.ts';
import type { Library } from '../templates/types.ts';
import { z } from 'zod';
import {
  ROLE_BRIEF,
  ROLE_FIELDS,
  type Bundle,
  type BundleItem,
  type SourceRole,
} from './types.ts';

/** Bumped whenever the prompt or the shape of the question below changes. */
export const COMPOSE_VERSION = '1';

export const COMPOSE_SYSTEM = `You are given several sources that together
describe one thing to make. Write the single description they add up to.

Each source has a job, and takes nothing from outside it.

${(Object.entries(ROLE_BRIEF) as Array<[Exclude<SourceRole, 'auto'>, string]>)
  .map(([role, brief]) => `- ${role}: ${brief}`)
  .join('\n')}

That last point is the one most often got wrong. A style source showing a snowy
street puts no snow in the picture; it contributes the grade, the light and the
grain of that photograph and nothing else. A subject source shot in a kitchen
does not put the picture in a kitchen unless it is also the setting source.

Where a source is marked auto, work out its job from what it says. A source that
is all grade and grain and names no subject is style. A source describing a
person, among sources describing rooms, is the subject.

Do not average. Two sources that disagree inside one job are not to be split
down the middle: that makes a third thing which is neither. Take the one whose
job owns the field. Where two sources share a job, the earlier one leads and the
later one adds only what the first left open.

Words and pictures do not carry the same authority. A picture is authoritative
for what something looks like. Words are authoritative for what is wanted: where
they ask for something no picture shows, follow them, and describe the result as
though it were already in front of you — not as a change, and never mentioning
that anything was asked for.

Fill every field you can from the sources. Where they genuinely say nothing,
leave it empty rather than inventing a plausible detail; where they nearly say
something, finish the thought rather than dropping it.`;

const roleOf = (item: BundleItem): string =>
  item.role === 'auto' ? 'auto — work out what it is for' : item.role;

const KIND_WORD: Record<BundleItem['kind'], string> = {
  words: 'What they typed',
  image: 'An image, read',
  video: 'A video, watched',
  audio: 'Audio, measured',
};

/** One source, as a labelled block the composer can tell from the others. */
export function sourceBlock(item: BundleItem, index: number): string {
  return [
    `--- Source ${index + 1}: ${KIND_WORD[item.kind]} (${item.id}) — job: ${roleOf(item)}`,
    ...item.lines,
  ].join('\n');
}

export function composeInstruction(bundle: Bundle): string {
  const useful = bundle.items.filter((i) => i.lines.some((l) => l.trim()));
  return [
    `${useful.length} sources. Write the one ${bundle.modality === 'video' ? 'shot' : bundle.modality === 'audio' ? 'piece' : 'image'} they describe.`,
    '',
    ...useful.map(sourceBlock),
  ].join('\n\n');
}

/** Who contributed what, worked out from the jobs rather than guessed at. */
export function provenanceOf(bundle: Bundle): ProvenanceEntry[] {
  return bundle.items
    .filter((i) => i.lines.some((l) => l.trim()))
    .map((item) => ({
      ref: item.id,
      fields: item.role === 'auto' ? [] : (ROLE_FIELDS[item.role] ?? []),
    }));
}

export interface ComposeOptions {
  /** Fill this template's variables instead of writing a whole document. */
  templateId?: string;
  library?: Library;
}

export interface ComposeResult {
  ir: PromptIR;
  usage: ProviderUsage;
  cached: boolean;
  key: string;
}

export class EmptyBundleError extends Error {
  constructor() {
    super('Nothing to work from: say something, or attach a reference.');
    this.name = 'EmptyBundleError';
  }
}

const titleOf = (bundle: Bundle): string | undefined =>
  bundle.items.find((i) => i.kind !== 'words')?.id ??
  bundle.items.find((i) => i.kind === 'words')?.lines[0]?.slice(0, 40);

export async function composeBundle(
  gateway: Gateway,
  bundle: Bundle,
  options: ComposeOptions = {},
): Promise<ComposeResult> {
  const useful = bundle.items.filter((i) => i.lines.some((l) => l.trim()));
  if (useful.length === 0) throw new EmptyBundleError();

  const instruction = composeInstruction(bundle);
  const provenance = provenanceOf(bundle);

  // With a template, the fields are the template's own questions and everything
  // it already decided stays decided — the composer never sees its document.
  if (options.templateId && options.library) {
    const template = options.library.templates.get(options.templateId);
    if (!template) {
      throw new Error(
        `No template called "${options.templateId}". ` +
          `Known: ${[...options.library.templates.keys()].join(', ') || '(none)'}.`,
      );
    }

    const variables = template.variables ?? [];
    const schema = z.object(
      Object.fromEntries(
        variables.map((v) => [
          v.name,
          z.string().describe([v.label, v.hint].filter(Boolean).join(' — ') || v.name),
        ]),
      ),
    );

    const result = await gateway.extract({
      system: COMPOSE_SYSTEM,
      instruction: `${instruction}\n\nAnswer only the fields asked for below.`,
      schema,
      schemaVersion: `${COMPOSE_VERSION}:${options.templateId}:${variables
        .map((v) => v.name)
        .join(',')}`,
    });

    const values = Object.fromEntries(
      Object.entries(result.value as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
    );
    const applied = applyTemplate(options.library, options.templateId, { values });

    return {
      ir: {
        ...applied.ir,
        title: applied.ir.title ?? titleOf(bundle) ?? template.name,
        provenance,
      },
      usage: result.usage,
      cached: result.cached,
      key: result.key,
    };
  }

  // The shape follows what is being made, not what the sources were: a
  // photograph and a sentence can perfectly well add up to a piece of music.
  // Written out per modality rather than as one call with a chosen schema,
  // because the answer's type is the schema's and there is no honest union.
  const reference = titleOf(bundle) ?? 'bundle';
  const version = `${COMPOSE_VERSION}:${bundle.modality}`;

  if (bundle.modality === 'video') {
    const result = await gateway.extract({
      system: COMPOSE_SYSTEM,
      instruction,
      schema: ExtractedShot,
      schemaVersion: version,
    });
    return {
      ir: { ...shotToIR(result.value, { reference }), provenance },
      usage: result.usage,
      cached: result.cached,
      key: result.key,
    };
  }

  if (bundle.modality === 'audio') {
    const result = await gateway.extract({
      system: COMPOSE_SYSTEM,
      instruction,
      schema: ImaginedSong,
      schemaVersion: version,
    });
    return {
      ir: { ...imaginedToIR(result.value, reference), provenance },
      usage: result.usage,
      cached: result.cached,
      key: result.key,
    };
  }

  const result = await gateway.extract({
    system: COMPOSE_SYSTEM,
    instruction,
    schema: ExtractedScene,
    schemaVersion: version,
  });

  return {
    // Provenance says which source was responsible for which part, which the
    // per-field map from a single reading cannot express once there are several.
    ir: {
      ...sceneToIR(result.value, { reference, modality: 'image' }),
      provenance,
    },
    usage: result.usage,
    cached: result.cached,
    key: result.key,
  };
}
