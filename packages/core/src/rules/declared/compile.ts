/**
 * A written-down rule, turned into the same `Rule` the engine already runs.
 *
 * The whole design rests on that sentence. There is one engine, one `Finding`,
 * one place a level means what it means — a declared rule is a different way of
 * *authoring*, not a different way of *running*. A second execution path would
 * be a second set of bugs and a second set of edge cases about what `autofix`
 * does, for no gain at all.
 */

import { getPath, setPath } from '../../ir/paths.ts';
import type { PromptIR } from '../../ir/types.ts';
import { assembleText } from '../../renderers/types.ts';
import type { Finding, Rule } from '../types.ts';
import { CHECK_KINDS, DeclaredRuleError, type DeclaredCheck, type DeclaredRule } from './types.ts';

const TEXT = 'text';

/** Escaped, so a word with a dot in it does not become a wildcard. */
const wordPattern = (words: string[]): RegExp =>
  new RegExp(
    `(^|[\\s,;:])(${words
      .map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .filter(Boolean)
      .join('|')})(?=$|[\\s,;.:])`,
    'gi',
  );

/**
 * What a removed list item leaves behind.
 *
 * Taking the last item out of "a, b and c" leaves "a, b and", and a dangling
 * conjunction reads worse to a model than the word that was removed. So the
 * seams get closed as well as the gap.
 */
const tidy = (s: string): string =>
  s
    .replace(/\s*,\s*,/g, ',')
    .replace(/,\s*([.;])/g, '$1')
    .replace(/\s+(and|or)\s*([,.;])/gi, '$2')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    // A conjunction or comma left hanging at either end. The word boundary
    // is load-bearing: without it, "a band" ends in "and".
    .replace(/[\s,]*\b(and|or)\s*$/i, '')
    .replace(/^\s*(and|or)\b[\s,]*/i, '')
    .replace(/^[\s,]+|[\s,]+$/g, '');

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : '';

export function checkDeclaredRule(rule: DeclaredRule, source: string): void {
  const say = (detail: string): never => {
    throw new DeclaredRuleError(source, detail);
  };

  if (!rule.id?.trim()) say('it has no id');
  if (!['autofix', 'warn', 'block'].includes(rule.level)) {
    say(`its level is "${rule.level}", not autofix, warn or block`);
  }
  if (!rule.rationale?.trim()) say('it has no rationale, so nobody could judge it');
  if (!rule.check) say('it has no check, so it does nothing');

  const check = rule.check;
  if (!CHECK_KINDS.includes(check.kind)) {
    say(`it asks for a "${check.kind}" check, which this build cannot run (${CHECK_KINDS.join(', ')})`);
  }

  if (check.kind === 'forbid-words' && !(check.words ?? []).some((w) => w.trim())) {
    say('it forbids no words');
  }
  if (check.kind === 'max-items' && !(Number.isInteger(check.max) && check.max >= 0)) {
    say(`its maximum is ${String(check.max)}, which is not a count`);
  }
  if (check.kind === 'matches') {
    if (!check.say?.trim()) say('it has no message, so a finding would say nothing');
    try {
      new RegExp(check.pattern, check.flags ?? '');
    } catch (err) {
      say(`its pattern will not compile (${(err as Error).message})`);
    }
  }
  if (check.kind === 'requires' && !(check.when?.trim() && check.needs?.trim())) {
    say('it names no pair of fields');
  }
}

const appliesTo = (rule: DeclaredRule): Rule['appliesTo'] => {
  const only = rule.appliesTo;
  if (!only) return undefined;

  return (ir, profile) =>
    (!only.modality || only.modality.includes(ir.modality)) &&
    (!only.mode || only.mode.includes(ir.mode)) &&
    (!only.family || only.family.includes(profile.family));
};

/** Compile it, or say precisely why it will not compile. */
export function declaredRule(rule: DeclaredRule, source = rule.id): Rule {
  checkDeclaredRule(rule, source);

  const base = {
    id: rule.id,
    level: rule.level,
    rationale: rule.rationale,
    ...(rule.source ? { source: rule.source } : {}),
    ...(rule.alwaysOn ? { alwaysOn: true } : {}),
    ...(appliesTo(rule) ? { appliesTo: appliesTo(rule)! } : {}),
  };

  const check: DeclaredCheck = rule.check;
  const finding = (message: string, fix?: string, path?: string): Finding => ({
    ruleId: rule.id,
    level: rule.level,
    message,
    ...(fix ? { fix } : {}),
    ...(path ? { path } : {}),
  });

  if (check.kind === 'forbid-words') {
    const pattern = wordPattern(check.words);
    const onText = check.in.includes(TEXT);
    const paths = check.in.filter((p) => p !== TEXT);

    return {
      ...base,
      ...(paths.length > 0
        ? {
            onIR(ir) {
              const findings: Finding[] = [];
              let next = ir;

              for (const path of paths) {
                const before = asText(getPath(next, path));
                if (!before) continue;

                const hits = new Set<string>();
                const after = tidy(
                  before.replace(pattern, (_m, lead: string, word: string) => {
                    hits.add(word.toLowerCase());
                    return lead;
                  }),
                );
                if (hits.size === 0) continue;

                findings.push(
                  finding(
                    `${path} uses ${[...hits].map((h) => `"${h}"`).join(', ')}.`,
                    check.fix === 'remove' ? 'Taken out.' : rule.rationale,
                    path,
                  ),
                );
                if (check.fix === 'remove') next = setPath(next, path, after);
              }

              return { ir: next, findings };
            },
          }
        : {}),
      ...(onText
        ? {
            onText(result) {
              const hits = new Set<string>();
              const segments = result.segments.map((s) => ({
                ...s,
                text: tidy(
                  s.text.replace(pattern, (_m, lead: string, word: string) => {
                    hits.add(word.toLowerCase());
                    return lead;
                  }),
                ),
              }));

              if (hits.size === 0) return { result, findings: [] };
              const message = `The prompt uses ${[...hits].map((h) => `"${h}"`).join(', ')}.`;

              return check.fix === 'remove'
                ? {
                    result: { ...result, segments, text: assembleText({ ...result, segments }) },
                    findings: [finding(message, 'Taken out.')],
                  }
                : { result, findings: [finding(message, rule.rationale)] };
            },
          }
        : {}),
    };
  }

  if (check.kind === 'max-items') {
    return {
      ...base,
      onIR(ir) {
        const value = getPath(ir, check.in);
        if (!Array.isArray(value) || value.length <= check.max) return { ir, findings: [] };

        const message = `${check.in} has ${value.length}; ${check.max} is the most that holds.`;
        return check.fix === 'trim'
          ? {
              ir: setPath(ir, check.in, value.slice(0, check.max)),
              findings: [finding(message, `Kept the first ${check.max}.`, check.in)],
            }
          : { ir, findings: [finding(message, rule.rationale, check.in)] };
      },
    };
  }

  if (check.kind === 'matches') {
    // Compiled once rather than per document, and without `g`: this only ever
    // asks whether it matched, and a sticky regex would answer differently on
    // every other call.
    const pattern = new RegExp(check.pattern, (check.flags ?? '').replace(/g/g, ''));
    const onText = check.in.includes(TEXT);
    const paths = check.in.filter((p) => p !== TEXT);

    return {
      ...base,
      ...(paths.length > 0
        ? {
            onIR(ir: PromptIR) {
              const findings = paths
                .filter((path) => pattern.test(asText(getPath(ir, path))))
                .map((path) => finding(check.say, rule.rationale, path));
              return { ir, findings };
            },
          }
        : {}),
      ...(onText
        ? {
            onText(result) {
              return {
                result,
                findings: pattern.test(result.text) ? [finding(check.say, rule.rationale)] : [],
              };
            },
          }
        : {}),
    };
  }

  return {
    ...base,
    onIR(ir) {
      const has = (path: string): boolean => {
        const value = getPath(ir, path);
        return Array.isArray(value) ? value.length > 0 : asText(value).trim().length > 0;
      };

      return {
        ir,
        findings:
          has(check.when) && !has(check.needs)
            ? [
                finding(
                  check.say ?? `${check.when} needs ${check.needs} beside it.`,
                  rule.rationale,
                  check.when,
                ),
              ]
            : [],
      };
    },
  };
}
