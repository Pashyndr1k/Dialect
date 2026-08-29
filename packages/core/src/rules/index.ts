import type { Rule } from './types.ts';
import { noBoosterWords } from './defs/no-booster-words.ts';
import { oneActionOneMove } from './defs/one-action-one-move.ts';
import { maxLookWords } from './defs/max-look-words.ts';
import { maxTrackedEntities } from './defs/max-tracked-entities.ts';
import { gearNeedsEffect } from './defs/gear-needs-effect.ts';
import { clipDurationLimit } from './defs/clip-duration-limit.ts';
import { quoteInImageText } from './defs/quote-in-image-text.ts';
import { emotionsArePhysical } from './defs/emotions-are-physical.ts';
import { onlyVisibleAndAudible } from './defs/only-visible-and-audible.ts';
import { exitFrameMeansGone } from './defs/exit-frame-means-gone.ts';
import { skinRealismBlock } from './defs/skin-realism-block.ts';

/**
 * Every rule the build knows about. Profiles opt in by id; rules marked
 * `alwaysOn` run regardless. Adding a rule means adding a file here — and
 * removing one is a single deletion, which is the point of keeping them apart.
 */
export const ALL_RULES: Rule[] = [
  noBoosterWords,
  gearNeedsEffect,
  clipDurationLimit,
  quoteInImageText,
  oneActionOneMove,
  maxLookWords,
  maxTrackedEntities,
  emotionsArePhysical,
  onlyVisibleAndAudible,
  exitFrameMeansGone,
  skinRealismBlock,
];

export const RULES_BY_ID: ReadonlyMap<string, Rule> = new Map(ALL_RULES.map((r) => [r.id, r]));

export * from './types.ts';
export * from './engine.ts';
