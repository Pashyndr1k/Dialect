import type { Rule } from './types.ts';
import { noBoosterWords } from './defs/no-booster-words.ts';
import { oneActionOneMove } from './defs/one-action-one-move.ts';
import { maxLookWords } from './defs/max-look-words.ts';
import { maxTrackedEntities } from './defs/max-tracked-entities.ts';
import { gearNeedsEffect } from './defs/gear-needs-effect.ts';

/**
 * Every rule the build knows about. Profiles opt in by id; rules marked
 * `alwaysOn` run regardless. Adding a rule means adding a file here — and
 * removing one is a single deletion, which is the point of keeping them apart.
 */
export const ALL_RULES: Rule[] = [
  noBoosterWords,
  oneActionOneMove,
  maxLookWords,
  maxTrackedEntities,
  gearNeedsEffect,
];

export const RULES_BY_ID: ReadonlyMap<string, Rule> = new Map(ALL_RULES.map((r) => [r.id, r]));

export * from './types.ts';
export * from './engine.ts';
