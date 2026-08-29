/**
 * Engine rules.
 *
 * These are empirical: they were found by testing specific versions of specific
 * models, and they age with those models. So every rule carries its source and
 * date, lives in its own file, and can be switched off without a refactor.
 *
 * What makes them worth encoding is that almost all of them are *countable* —
 * no more than three look words, one action per clip, at most three tracked
 * characters. A language model asked to hold fifteen such constraints in mind
 * will drop half of them on a long prompt. A validator will not.
 */

import type { PromptIR } from '../ir/types.ts';
import type { ModelProfile } from '../registry/types.ts';
import type { RenderResult } from '../renderers/types.ts';

export type RuleLevel =
  /** The compiler fixes it silently and leaves a trace in the source map. */
  | 'autofix'
  /** The prompt still compiles, but the editor shows a flag and an offer to fix. */
  | 'warn'
  /** No prompt is produced, because the result would be broken anyway. */
  | 'block';

export interface Finding {
  ruleId: string;
  level: RuleLevel;
  /** What is wrong, in the user's terms. */
  message: string;
  /** What to do about it. Present whenever there is a concrete next step. */
  fix?: string;
  /** IR path the finding attaches to, for jumping to it in the editor. */
  path?: string;
}

export interface IRPass {
  ir: PromptIR;
  findings: Finding[];
}

export interface TextPass {
  result: RenderResult;
  findings: Finding[];
}

export interface Rule {
  id: string;
  level: RuleLevel;
  /** Why this exists. Shown in the rule library and in the finding's detail view. */
  rationale: string;
  source?: { name: string; dated: string };
  /** Runs for every profile, not only those listing it. */
  alwaysOn?: boolean;
  /** Cheap guard so a rule can opt out of irrelevant documents. */
  appliesTo?: (ir: PromptIR, profile: ModelProfile) => boolean;
  /** Runs before rendering. May return a corrected IR. */
  onIR?: (ir: PromptIR, profile: ModelProfile) => IRPass;
  /** Runs on the rendered prompt. May return a corrected result. */
  onText?: (result: RenderResult, profile: ModelProfile) => TextPass;
}

export class BlockedError extends Error {
  readonly findings: Finding[];
  constructor(findings: Finding[]) {
    const list = findings.map((f) => `  · ${f.message}${f.fix ? ` — ${f.fix}` : ''}`).join('\n');
    super(`This prompt would not survive generation:\n${list}`);
    this.name = 'BlockedError';
    this.findings = findings;
  }
}
