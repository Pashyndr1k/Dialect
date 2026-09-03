/**
 * Turning a few words into a whole document.
 *
 * This is the opposite job to reading a reference, and it needs the opposite
 * instruction. Reading says: describe what is there, and where the picture does
 * not tell you, say so. Writing from an idea says: decide. Someone who types
 * "a cowboy in a saloon" is asking for the two hundred words they did not want
 * to write, and a description hedged with "perhaps a coat, or a jacket" is not
 * a description — the model downstream will pick one anyway, badly.
 *
 * What does not change is the discipline. Everything added still has to be
 * something a camera could record, a shot still gets one action, optics are
 * still a visible effect rather than a lens number. The rules engine will hold
 * the result to exactly the same standards as a document read off a photograph,
 * so it may as well be written to them.
 *
 * With a template chosen the job narrows and improves: instead of inventing a
 * whole document, the model fills the template's variables, and the template
 * decides everything else. The hints in the template are written as
 * instructions already, so they are handed over as the field descriptions.
 */

import { z } from 'zod';
import type { Gateway } from '../providers/gateway.ts';
import type { ImagePart, ProviderUsage } from '../providers/types.ts';
import type { Modality, PromptIR } from '../ir/types.ts';
import { ExtractedScene } from './schema.ts';
import { sceneToIR } from './image.ts';
import { ExtractedShot, shotToIR } from './video.ts';
import { songToIR, type ExtractedSong } from './audio.ts';
import { applyTemplate } from '../templates/apply.ts';
import type { Library } from '../templates/types.ts';

/** Bumped whenever a schema or a prompt in this file changes. */
export const IDEA_VERSION = '1';

/**
 * A piece of music nobody has recorded yet.
 *
 * Shaped differently from audio that was read, because the two differ in what
 * is knowable: a reading takes tempo and key from measurement and refuses to
 * guess, while here there is nothing to measure and choosing them is the work.
 */
export const ImaginedSong = z.object({
  genre: z.string().describe('the closest genre, or a phrase for the sound if none fits'),
  bpm: z.number().describe('a tempo that suits it. Choose one; do not offer a range.'),
  musicalKey: z.string().describe('e.g. "A minor"'),
  instruments: z.array(z.string()).describe('what plays it, in the order they should read'),
  vocals: z.boolean().describe('whether anyone sings'),
  vocalDescription: z.string().describe('the voice, if there is one. Empty otherwise.'),
  structure: z.array(z.string()).describe('section labels in order, e.g. intro, verse, chorus'),
  lyrics: z
    .string()
    .describe(
      'the words, with [Section] markers, only if the idea calls for a song with words. ' +
        'Empty for anything instrumental — invented lyrics get sung.',
    ),
  mood: z.string().describe('how it feels, in a phrase'),
  mix: z.string().describe('how it is produced: bright or dark, dry or reverberant, dense or sparse'),
});

export type ImaginedSong = z.infer<typeof ImaginedSong>;

export const IDEA_SYSTEM = `Someone has told you what they want in a few words.
Write it out in full: one specific thing, described so it could be made from
your description alone.

Decide. They came to you precisely so they would not have to choose the coat,
the light, the time of day. "Perhaps a duster, or a canvas jacket" is not a
description; something downstream will pick one anyway, and worse than you
would. Where the idea is silent, choose something that suits it and commit.

Keep what they did say. If they said a red door, the door is red, and every
choice around it serves that rather than competing with it. Their words are the
only part of this that is not yours to change.

Describe what a camera would record. Not what anyone feels — what is visible:
a jaw set, shoulders dropped, a hand that stops halfway. Not "melancholy", but
the thing that makes it look that way.

Report optics by their visible result, never by equipment. Focal lengths and
apertures are not something a description needs and models do not respond to
them.

Be specific in the way that survives generation: materials, wear, colour,
weight, what light is doing on a surface. Avoid words that only assert quality —
masterpiece, stunning, 8K, highly detailed. They add nothing and crowd out the
words that do.`;

export const SHOT_IDEA_SYSTEM = `${IDEA_SYSTEM}

This is one shot, not a scene. One action for the subject and one move for the
camera: a second action belongs in a second shot, and asking for both in one
clip is what makes a model interpolate between them.

"Static" is a real choice for the camera and often the right one.`;

export const SONG_IDEA_SYSTEM = `Someone has told you what they want in a few
words. Write it out in full as one specific piece of music, described so it
could be recorded from your description alone.

Decide. Choose a tempo, a key, an instrumentation, and commit to them rather
than offering a range.

Keep what they did say. Their words are the only part of this that is not yours
to change.

Name only instruments you actually mean to hear: everything named will be
generated, so a short deliberate list beats a long one.

Write lyrics only if the idea asks for a song with words. Anything you put in
the lyrics will be sung, so an instrumental gets none.`;

export const TEMPLATE_SYSTEM = `Someone has told you what they want in a few
words, and chosen a template that decides the rest. Fill in the template's
fields from their idea.

Answer each field as the field asks for it: they are the instructions of the
person who wrote the template, and they are the point of using one.

Decide rather than hedge, and keep whatever the idea already said. Where the
idea is silent, choose something that suits it. Describe what a camera would
record, and avoid words that only assert quality.`;

export const TEMPLATE_WITH_REFERENCE_SYSTEM = `${TEMPLATE_SYSTEM}

You are also shown a reference. Fill the fields from what is actually in it,
described concretely enough to be rebuilt — not from what it reminds you of.

Where their words touch something the reference shows, follow their words and
write the result as though it were already in front of you. Everything they did
not touch stays as the reference has it.

The template's own fixed parts are not yours to reproduce: answer the fields and
nothing else.`;

export interface IdeaOptions {
  /** What is being made. Normally the target model's family. */
  modality: Modality;
  /** Recorded in provenance so the source map says where a field came from. */
  reference?: string;
}

export interface IdeaResult {
  ir: PromptIR;
  usage: ProviderUsage;
  cached: boolean;
  key: string;
}

export class EmptyIdeaError extends Error {
  constructor() {
    super('Say at least one word about what you want.');
    this.name = 'EmptyIdeaError';
  }
}

const words = (idea: string): string[] => idea.trim().split(/\s+/).filter(Boolean);

/** Long enough to recognise in a source map, short enough to sit in a label. */
export function ideaLabel(idea: string): string {
  const text = idea.trim().replace(/\s+/g, ' ');
  return text.length <= 40 ? text : `${text.slice(0, 39)}…`;
}

/** A whole document from a few words, with no template to shape it. */
export async function expandIdea(
  gateway: Gateway,
  idea: string,
  options: IdeaOptions,
): Promise<IdeaResult> {
  if (words(idea).length === 0) throw new EmptyIdeaError();

  const reference = options.reference ?? ideaLabel(idea);
  const instruction = `The idea, in their words: "${idea.trim()}"`;

  if (options.modality === 'audio') {
    const result = await gateway.extract({
      system: SONG_IDEA_SYSTEM,
      instruction,
      schema: ImaginedSong,
      schemaVersion: IDEA_VERSION,
    });
    return { ...result, ir: imaginedToIR(result.value, reference) };
  }

  if (options.modality === 'video') {
    const result = await gateway.extract({
      system: SHOT_IDEA_SYSTEM,
      instruction,
      schema: ExtractedShot,
      schemaVersion: IDEA_VERSION,
    });
    return { ...result, ir: shotToIR(result.value, { reference }) };
  }

  const result = await gateway.extract({
    system: IDEA_SYSTEM,
    instruction,
    schema: ExtractedScene,
    schemaVersion: IDEA_VERSION,
  });
  return { ...result, ir: sceneToIR(result.value, { reference, modality: 'image' }) };
}

/** The song schema reshaped into the one the audio dialects read. */
export function imaginedToIR(song: ImaginedSong, reference: string): PromptIR {
  const asRead: ExtractedSong = {
    genre: song.genre,
    instruments: song.instruments,
    vocals: song.vocals ? 'present' : 'none',
    vocalDescription: song.vocalDescription,
    structure: song.structure,
    mood: song.mood,
    mix: song.mix,
    uncertain: [],
  };

  const ir = songToIR(asRead, {
    reference,
    bpm: song.bpm,
    musicalKey: song.musicalKey,
  });

  // Lyrics are a script: anything in the box gets sung, so an empty answer has
  // to stay empty rather than becoming an empty string in the document.
  return song.lyrics.trim()
    ? { ...ir, audio: { ...ir.audio, lyrics: song.lyrics.trim() } }
    : ir;
}

export interface TemplateIdeaResult extends IdeaResult {
  /** What the model decided each variable should be, for the editor to show. */
  values: Record<string, string>;
}

/**
 * Fill a template's variables from an idea, then apply it.
 *
 * The model never sees the template's IR, only the questions it asks. That is
 * deliberate: a template is a decision about the look, and letting a model
 * rewrite it would defeat the point of having chosen one.
 */
export async function fillTemplate(
  gateway: Gateway,
  idea: string,
  library: Library,
  templateId: string,
  images: ImagePart[] = [],
): Promise<TemplateIdeaResult> {
  // With a reference in hand there is something to fill the template from, so
  // words stop being the only source and stop being required.
  if (words(idea).length === 0 && images.length === 0) throw new EmptyIdeaError();

  const template = library.templates.get(templateId);
  if (!template) {
    throw new Error(
      `No template called "${templateId}". Known: ${[...library.templates.keys()].join(', ') || '(none)'}.`,
    );
  }

  const variables = template.variables ?? [];
  if (variables.length === 0) {
    // Nothing to ask about, so nothing to pay for.
    const applied = applyTemplate(library, templateId);
    return {
      ir: applied.ir,
      values: applied.used,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0 },
      cached: true,
      key: `template:${templateId}`,
    };
  }

  const schema = z.object(
    Object.fromEntries(
      variables.map((v) => [
        v.name,
        z.string().describe([v.label, v.hint].filter(Boolean).join(' — ') || v.name),
      ]),
    ),
  );

  const said = idea.trim();
  const result = await gateway.extract({
    system: images.length > 0 ? TEMPLATE_WITH_REFERENCE_SYSTEM : TEMPLATE_SYSTEM,
    ...(images.length > 0 ? { images } : {}),
    instruction: [
      images.length > 0
        ? said
          ? `A reference, and what they said about it: "${said}"`
          : 'A reference, and nothing said about it — take the fields from what is there.'
        : `The idea, in their words: "${said}"`,
      `The template is "${template.name}"${template.description ? `: ${template.description.trim().replace(/\s+/g, ' ')}` : ''}`,
    ].join('\n'),
    schema,
    // The template's own fields are part of the question, so a template that
    // changes must not reuse an answer bought for the old one.
    schemaVersion: `${IDEA_VERSION}:${templateId}:${variables.map((v) => v.name).join(',')}`,
  });

  const values = Object.fromEntries(
    Object.entries(result.value as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
  );
  const applied = applyTemplate(library, templateId, { values });

  return {
    ir: { ...applied.ir, title: applied.ir.title ?? (said ? ideaLabel(said) : template.name) },
    values: applied.used,
    usage: result.usage,
    cached: result.cached,
    key: result.key,
  };
}
