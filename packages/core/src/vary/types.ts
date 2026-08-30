/**
 * Variation: many documents from one, differing along a named axis.
 *
 * Two things make this cheap and worth having, and both were bought earlier.
 *
 * Composition is the cheap call — it carries no pictures — so twenty variants
 * of a character cost what one reading of a photograph does. And a variant is a
 * delta rather than a document: everything not on the axis is already decided,
 * so the answer is a handful of fields and not another two hundred words each.
 *
 * The third thing is not about cost. Twenty separate calls produce twenty
 * similar answers, because nothing tells any of them what the others said. One
 * call producing twenty is the only version of this that actually varies.
 */

import type { Modality } from '../ir/types.ts';

/** What is allowed to move. Everything else is held. */
export const VARY_AXES = ['subject', 'look', 'mood', 'framing', 'moment'] as const;
export type VaryAxis = (typeof VARY_AXES)[number];

export const AXIS_LABEL: Record<VaryAxis, string> = {
  subject: 'who or what',
  look: 'how it looks',
  mood: 'how it feels',
  framing: 'the framing',
  moment: 'the moment',
};

/** What each axis is allowed to touch, in the composer's own words. */
export const AXIS_BRIEF: Record<VaryAxis, string> = {
  subject:
    'who or what is in it, and what they do. Not where, not the light, not the medium — a ' +
    'different person in the same picture.',
  look: 'the medium, the grade, the light and the grain. Not who is in it and not where.',
  mood: 'the atmosphere and what it feels like, described physically. Nothing else moves.',
  framing: 'the shot size and the angle. The same subject, seen differently.',
  moment: 'what happens and how the camera moves. One action each.',
};

/** Which IR paths an axis owns, for provenance and for the merge. */
export const AXIS_FIELDS: Record<VaryAxis, string[]> = {
  subject: ['subject.headline', 'subject.entities', 'subject.action'],
  look: ['style', 'lighting', 'palette', 'texture'],
  mood: ['mood'],
  framing: ['shot'],
  moment: ['subject.action', 'cameraMove', 'beats'],
};

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

export interface DeckEntry {
  id: string;
  name: string;
  /** What it does to the prompt, in the deck author's words. */
  text: string;
}

export interface Deck {
  id: string;
  name: string;
  about: string;
  /** The axis it belongs to, or `any` for something that applies to all. */
  axis: VaryAxis | 'any';
  entries: DeckEntry[];
  source?: { name: string; dated: string };
}

/** One entry, chosen at random. Deterministic when `pick` is supplied. */
export function drawFrom(deck: Deck, pick: () => number = Math.random): DeckEntry | undefined {
  if (deck.entries.length === 0) return undefined;
  const at = Math.min(deck.entries.length - 1, Math.floor(pick() * deck.entries.length));
  return deck.entries[at];
}

export const decksFor = (decks: Deck[], axis: VaryAxis): Deck[] =>
  decks.filter((d) => d.axis === axis || d.axis === 'any');

// ---------------------------------------------------------------------------

export interface VaryOptions {
  axis: VaryAxis;
  /** How many to ask for. More than a dozen and they start repeating. */
  count: number;
  modality?: Modality;
  /** A sentence narrowing what the variants should be, e.g. "townsfolk". */
  brief?: string;
  /** One card drawn from a deck, pushed into the question as a constraint. */
  nudge?: DeckEntry;
}

export const MAX_VARIANTS = 24;
