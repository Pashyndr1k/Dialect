import type { PromptIR } from '../ir/types.ts';
import type { ModelProfile } from '../registry/types.ts';
import type { RenderResult } from '../renderers/types.ts';
import type { Finding, IRPass, Rule, TextPass } from './types.ts';

export class UnknownRuleError extends Error {
  constructor(profileId: string, ruleId: string, known: string[]) {
    super(
      `Profile "${profileId}" lists a rule named "${ruleId}", which this build does not have. ` +
        `Known rules: ${known.join(', ')}.`,
    );
    this.name = 'UnknownRuleError';
  }
}

export interface SelectOptions {
  /** Rule ids the user switched off. A stale rule should be disabled, not deleted. */
  disabled?: readonly string[];
}

/**
 * The rules that apply to one target: everything marked `alwaysOn`, plus
 * whatever the profile opts into.
 *
 * An id this build does not have is skipped rather than thrown over. That was
 * the other way round, on the argument that a typo must not quietly disable a
 * check — and the argument was right, but this was the wrong place for it. Once
 * a card set can arrive from a channel, a card naming a rule from a newer build
 * is ordinary rather than a mistake, and losing the whole card over one missing
 * check is worse than losing the check.
 *
 * The strictness moved to where a card is loaded, which can say which card and
 * which rule and leave the one underneath it standing.
 */
export function selectRules(
  profile: ModelProfile,
  all: readonly Rule[],
  options: SelectOptions = {},
): Rule[] {
  const byId = new Map(all.map((r) => [r.id, r]));
  const disabled = new Set(options.disabled ?? []);
  const chosen = new Map<string, Rule>();

  for (const rule of all) {
    if (rule.alwaysOn && !disabled.has(rule.id)) chosen.set(rule.id, rule);
  }
  for (const id of profile.rules ?? []) {
    const rule = byId.get(id);
    if (rule && !disabled.has(id)) chosen.set(id, rule);
  }
  return [...chosen.values()];
}

/** Run the IR-stage rules in order, threading each rule's corrections forward. */
export function runIRRules(ir: PromptIR, profile: ModelProfile, rules: readonly Rule[]): IRPass {
  let current = ir;
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (!rule.onIR) continue;
    if (rule.appliesTo && !rule.appliesTo(current, profile)) continue;
    const pass = rule.onIR(current, profile);
    current = pass.ir;
    findings.push(...pass.findings);
  }
  return { ir: current, findings };
}

/** Run the text-stage rules against the rendered prompt. */
export function runTextRules(
  result: RenderResult,
  profile: ModelProfile,
  rules: readonly Rule[],
  ir?: PromptIR,
): TextPass {
  let current = result;
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (!rule.onText) continue;
    if (ir && rule.appliesTo && !rule.appliesTo(ir, profile)) continue;
    const pass = rule.onText(current, profile);
    current = pass.result;
    findings.push(...pass.findings);
  }
  return { result: current, findings };
}

export function blockingFindings(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.level === 'block');
}
