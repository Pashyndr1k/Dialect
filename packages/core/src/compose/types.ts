/**
 * A bundle: everything someone brought, and what each of it is for.
 *
 * A reference and a sentence do not have fixed jobs. Someone can describe a
 * character and attach a photograph for its light; someone else can attach a
 * photograph of a character and type the light. The same two things, opposite
 * ways round — so the job is a property of each source, not of its kind.
 *
 * Every source arrives here already reduced to lines. A picture has been read,
 * a clip has been watched, a track has been measured; what is left is text, and
 * composing is a text problem. That split is what makes iteration cheap: the
 * reading is bought once, and changing a word buys only the composition again.
 */

import type { Modality } from '../ir/types.ts';

export const SOURCE_ROLES = [
  'auto',
  'subject',
  'style',
  'detail',
  'setting',
  'composition',
] as const;

export type SourceRole = (typeof SOURCE_ROLES)[number];

export const ROLE_LABEL: Record<SourceRole, string> = {
  auto: 'auto',
  subject: 'subject',
  style: 'style',
  detail: 'detail',
  setting: 'setting',
  composition: 'framing',
};

/** What each job is allowed to decide, in the composer's own words. */
export const ROLE_BRIEF: Record<Exclude<SourceRole, 'auto'>, string> = {
  subject: 'who or what this is — the thing being made, and what it does',
  style: 'how it looks: medium, light, grade, texture, grain. Nothing about what is in it.',
  detail: 'additions to the subject — wardrobe, marks, props — without replacing it',
  setting: 'where it is, and when',
  composition: 'framing, angle, distance and aspect. Nothing else.',
};

/**
 * Which parts of the document a job owns.
 *
 * Used for provenance rather than for enforcement: the roles are a claim about
 * what each source is for, so recording them against the fields they cover is
 * a fact rather than a guess about what the model did with them.
 */
export const ROLE_FIELDS: Record<Exclude<SourceRole, 'auto'>, string[]> = {
  subject: ['subject.headline', 'subject.entities', 'subject.action'],
  style: ['style', 'lighting', 'palette', 'texture', 'optics'],
  detail: ['subject.entities'],
  setting: ['environment', 'mood'],
  composition: ['shot'],
};

export type SourceKind = 'words' | 'image' | 'video' | 'audio';

export interface BundleItem {
  /** File name, or `words` for what was typed. */
  id: string;
  kind: SourceKind;
  role: SourceRole;
  /** What this source says, already read. One statement per line. */
  lines: string[];
}

export interface Bundle {
  items: BundleItem[];
  modality: Modality;
}

/** Whether there is anything to combine, or only one thing to pass through. */
export const worthComposing = (bundle: Bundle): boolean =>
  bundle.items.filter((i) => i.lines.some((l) => l.trim())).length > 1;
