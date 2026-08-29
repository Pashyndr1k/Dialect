/**
 * The compiler: IR plus a profile in, a prompt out.
 *
 * Deliberately deterministic. No language model runs here, which is why
 * composing a thousand prompts costs nothing and why the same IR always
 * produces the same text — the property golden tests depend on.
 */

import type { PromptIR } from './ir/types.ts';
import type { ModelProfile } from './registry/types.ts';
import type { RenderResult } from './renderers/types.ts';
import { RENDERERS, UnknownRendererError } from './renderers/index.ts';
import type { Finding, Rule } from './rules/types.ts';
import { BlockedError } from './rules/types.ts';
import { ALL_RULES } from './rules/index.ts';
import { blockingFindings, runIRRules, runTextRules, selectRules } from './rules/engine.ts';

export interface CompileOptions {
  /** Override the rule set, e.g. in tests. Defaults to everything the build has. */
  rules?: readonly Rule[];
  /** Rule ids the user switched off. */
  disabledRules?: readonly string[];
  /**
   * Throw on a block-level finding instead of returning `blocked: true`.
   * Batch runs turn this off so one bad file does not stop the queue.
   */
  throwOnBlock?: boolean;
}

export interface CompileResult {
  target: string;
  profile: ModelProfile;
  /** The IR after autofixes, which is what the editor should show. */
  ir: PromptIR;
  render: RenderResult;
  findings: Finding[];
  blocked: boolean;
}

/** Deep-ish clone that keeps plain data plain. IR is JSON by construction. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

function setIfUnset(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  const last = parts.pop();
  if (!last) return;

  let cursor: Record<string, unknown> = target;
  for (const part of parts) {
    const next = cursor[part];
    if (next === undefined || next === null || typeof next !== 'object') {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  if (cursor[last] === undefined) cursor[last] = value;
}

/**
 * Apply the profile's defaults to any field the author left open. Never
 * overrides an explicit choice — "no music" is a default, not a policy.
 */
export function applyProfileDefaults(ir: PromptIR, profile: ModelProfile): PromptIR {
  if (!profile.defaults) return ir;
  const next = clone(ir) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(profile.defaults)) {
    setIfUnset(next, path, value);
  }
  return next as unknown as PromptIR;
}

export function compile(
  input: PromptIR,
  profile: ModelProfile,
  options: CompileOptions = {},
): CompileResult {
  const renderer = RENDERERS[profile.renderer];
  if (!renderer) throw new UnknownRendererError(profile.id, profile.renderer);

  const rules = selectRules(profile, options.rules ?? ALL_RULES, {
    disabled: options.disabledRules ?? [],
  });

  const withDefaults = applyProfileDefaults(input, profile);
  const irPass = runIRRules(withDefaults, profile, rules);

  const findings: Finding[] = [...irPass.findings];

  // A blocked document is still rendered so the editor can show what would have
  // been produced alongside the reason it will not ship.
  const rendered: RenderResult = renderer(irPass.ir, profile);
  const textPass = runTextRules(rendered, profile, rules, irPass.ir);
  findings.push(...textPass.findings);

  const stillBlocked = blockingFindings(findings).length > 0;
  if (stillBlocked && (options.throwOnBlock ?? false)) {
    throw new BlockedError(blockingFindings(findings));
  }

  return {
    target: profile.id,
    profile,
    ir: irPass.ir,
    render: textPass.result,
    findings,
    blocked: stillBlocked,
  };
}
