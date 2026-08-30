/**
 * Rules a card set can ship.
 *
 * Phase 7 made the model cards replaceable and signed, and left one hole: a
 * card is data but a rule is code, so an update could change what every model's
 * formula looks like and could not add a single new check. That is backwards.
 * The rules are the part most likely to age — a booster word that worked last
 * month reads as noise this month, and finding that out is exactly the sort of
 * thing an update should be able to carry.
 *
 * So a rule can also be written down. Not all of them: `one-action-one-move`
 * knows what a second action looks like in a way a config file does not, and
 * pretending otherwise would produce a DSL that is a worse programming language
 * than the one underneath it.
 *
 * What is written down instead is the shape almost every *new* rule turns out
 * to have — a list of words that stopped working, a pattern that started
 * failing, a count a model will not hold, a field that needs another beside it.
 * Four checks, each of which compiles to exactly the same `Rule` the engine
 * already runs. There is no second engine.
 */

import type { Modality, Mode } from '../../ir/types.ts';
import type { RuleLevel } from '../types.ts';

export const CHECK_KINDS = ['forbid-words', 'max-items', 'matches', 'requires'] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/** `text` means the rendered prompt; anything else is an IR path. */
export type Where = string;

export type DeclaredCheck =
  /**
   * Words that stopped working. The commonest reason to ship a rule at all,
   * and the reason this exists.
   */
  | {
      kind: 'forbid-words';
      in: Where[];
      words: string[];
      /** Take them out rather than merely flagging them. */
      fix?: 'remove';
    }
  /** A count a model will not hold — look words, tracked faces, layers. */
  | { kind: 'max-items'; in: string; max: number; fix?: 'trim' }
  /** A pattern that started failing. `say` is what the person is told. */
  | { kind: 'matches'; in: Where[]; pattern: string; flags?: string; say: string }
  /** One field that means nothing without another. */
  | { kind: 'requires'; when: string; needs: string; say?: string };

export interface DeclaredApplies {
  modality?: Modality[];
  mode?: Mode[];
  family?: string[];
}

export interface DeclaredRule {
  id: string;
  level: RuleLevel;
  /** Why it exists. Shown beside every finding it raises. */
  rationale: string;
  /** Runs for every profile rather than only those listing it. */
  alwaysOn?: boolean;
  appliesTo?: DeclaredApplies;
  check: DeclaredCheck;
  /**
   * Where it came from and when. Not decoration: these age, and a rule with no
   * date is one nobody can decide whether to trust.
   */
  source?: { name: string; dated: string };
}

export class DeclaredRuleError extends Error {
  constructor(source: string, detail: string) {
    super(`Rule ${source} is not usable: ${detail}`);
    this.name = 'DeclaredRuleError';
  }
}
