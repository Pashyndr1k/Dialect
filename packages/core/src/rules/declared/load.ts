import { parse as parseYaml } from 'yaml';
import type { Rule } from '../types.ts';
import { declaredRule } from './compile.ts';
import { DeclaredRuleError, type DeclaredRule } from './types.ts';

/**
 * A rule file, read.
 *
 * Same shape as the cards: one bad file is reported and skipped rather than
 * taking the set with it, because a rule that will not load is a check that
 * does not run and not a reason to lose the other ten.
 */
export function parseDeclaredRule(text: string, source: string): DeclaredRule {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new DeclaredRuleError(source, `it is not valid YAML (${(err as Error).message})`);
  }
  if (raw === null || typeof raw !== 'object') {
    throw new DeclaredRuleError(source, 'it is empty or not a mapping');
  }

  const rule = raw as DeclaredRule;
  // Compiling is the check: a rule that cannot be turned into one is not one.
  declaredRule(rule, source);
  return rule;
}

export interface RuleRejection {
  source: string;
  reason: string;
}

export function parseDeclaredRules(
  files: Array<{ source: string; text: string }>,
): { rules: Rule[]; rejected: RuleRejection[] } {
  const rules: Rule[] = [];
  const rejected: RuleRejection[] = [];

  for (const file of files) {
    try {
      rules.push(declaredRule(parseDeclaredRule(file.text, file.source), file.source));
    } catch (err) {
      rejected.push({
        source: file.source,
        reason:
          err instanceof DeclaredRuleError
            ? err.message.replace(/^Rule [^ ]+ is not usable: /, '')
            : String(err),
      });
    }
  }

  return { rules, rejected };
}
