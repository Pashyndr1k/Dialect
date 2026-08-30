import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { emptyIR, type PromptIR } from '../src/ir/types.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import {
  declaredRule,
  DeclaredRuleError,
  parseDeclaredRules,
  type DeclaredRule,
} from '../src/rules/declared/index.ts';

const registry = await loadBuiltinRegistry();
const kling = getProfile(registry, 'kling-3-omni');
const banana = getProfile(registry, 'nano-banana-2');

const SCENE: PromptIR = {
  ...emptyIR('image'),
  subject: { headline: 'a bottle on slate, hyperrealistic and ultra-detailed' },
  environment: { location: 'a studio' },
  lighting: { key: 'hard raking light', lookWords: ['cinematic', 'moody', 'shadowplay', 'epic'] },
  style: { medium: 'photograph' },
  optics: { gearHint: '50mm' },
};

const rule = (over: Partial<DeclaredRule>): DeclaredRule => ({
  id: 'a-rule',
  level: 'warn',
  rationale: 'because it was found to matter, in testing, on a dated checkpoint',
  check: { kind: 'matches', in: ['text'], pattern: 'nope', say: 'nope' },
  ...over,
});

const findingsOf = (ir: PromptIR, r: DeclaredRule, profile = banana) =>
  compile(ir, profile, { rules: [declaredRule(r)] }).findings;

describe('words that stopped working', () => {
  const forbidding = (fix?: 'remove'): DeclaredRule =>
    rule({
      id: 'no-cheugy',
      level: 'autofix',
      alwaysOn: true,
      check: {
        kind: 'forbid-words',
        in: ['subject.headline'],
        words: ['hyperrealistic', 'ultra-detailed'],
        ...(fix ? { fix } : {}),
      },
    });

  it('finds them, and says which', () => {
    const [found] = findingsOf(SCENE, forbidding());

    expect(found?.ruleId).toBe('no-cheugy');
    expect(found?.message).toContain('"hyperrealistic"');
    expect(found?.message).toContain('"ultra-detailed"');
    expect(found?.path).toBe('subject.headline');
  });

  it('takes them out when told to, and closes the seam behind them', () => {
    const { ir } = compile(SCENE, banana, { rules: [declaredRule(forbidding('remove'))] });

    // "…slate, hyperrealistic and ultra-detailed" would otherwise leave the
    // "and" hanging, which reads worse than the word that was removed.
    expect(ir.subject?.headline).toBe('a bottle on slate');
  });

  it('closes it at either end of a list, not only in the middle', () => {
    const trailing = declaredRule(
      rule({
        id: 'trim-list',
        level: 'autofix',
        alwaysOn: true,
        check: { kind: 'forbid-words', in: ['style.medium'], words: ['gone'], fix: 'remove' },
      }),
    );

    const cases: Array<[string, string]> = [
      ['a, b and gone', 'a, b'],
      ['gone, a and b', 'a and b'],
      ['a, gone, b', 'a, b'],
      ['gone', ''],
      // The word boundary earns its keep here: without it, "band" ends in "and".
      ['a band and gone', 'a band'],
    ];

    for (const [before, after] of cases) {
      const { ir } = compile({ ...SCENE, style: { medium: before } }, banana, {
        rules: [trailing],
      });
      expect(ir.style?.medium ?? '', before).toBe(after);
    }
  });

  it('leaves them alone when it is only meant to flag', () => {
    const { ir, findings } = compile(SCENE, banana, { rules: [declaredRule(forbidding())] });

    expect(findings).toHaveLength(1);
    expect(ir.subject?.headline).toContain('hyperrealistic');
  });

  it('works on the rendered prompt too, which is where a booster usually lands', () => {
    const overText = rule({
      id: 'no-cheugy-text',
      level: 'autofix',
      alwaysOn: true,
      check: { kind: 'forbid-words', in: ['text'], words: ['hyperrealistic'], fix: 'remove' },
    });

    const { render, findings } = compile(SCENE, banana, { rules: [declaredRule(overText)] });
    expect(findings[0]?.message).toContain('The prompt uses');
    expect(render.text).not.toContain('hyperrealistic');
  });

  it('matches a word and not the middle of another', () => {
    const shy = rule({
      id: 'no-art',
      alwaysOn: true,
      check: { kind: 'forbid-words', in: ['style.medium'], words: ['art'] },
    });

    const ir = { ...SCENE, style: { medium: 'a chart of departures' } };
    expect(findingsOf(ir, shy)).toEqual([]);
  });
});

describe('a count a model will not hold', () => {
  const capping = (max: number, fix?: 'trim'): DeclaredRule =>
    rule({
      id: 'fewer-looks',
      level: 'autofix',
      alwaysOn: true,
      check: { kind: 'max-items', in: 'lighting.lookWords', max, ...(fix ? { fix } : {}) },
    });

  it('counts, and says what would hold', () => {
    const [found] = findingsOf(SCENE, capping(2));

    expect(found?.message).toContain('has 4');
    expect(found?.message).toContain('2 is the most');
  });

  it('trims when told to, keeping the ones that came first', () => {
    const { ir } = compile(SCENE, banana, { rules: [declaredRule(capping(2, 'trim'))] });
    expect(ir.lighting?.lookWords).toEqual(['cinematic', 'moody']);
  });

  it('says nothing when the count is fine', () => {
    expect(findingsOf(SCENE, capping(9))).toEqual([]);
  });
});

describe('a pattern that started failing', () => {
  it('flags what it matches, in the words the rule gives', () => {
    const noThen = rule({
      id: 'no-then',
      level: 'block',
      alwaysOn: true,
      check: {
        kind: 'matches',
        in: ['subject.action'],
        pattern: '\\bthen\\b',
        flags: 'i',
        say: 'This carries a second action.',
      },
    });

    const two = { ...SCENE, subject: { ...SCENE.subject, action: 'lifts it, then turns' } };
    const [found] = findingsOf(two, noThen);

    expect(found?.message).toBe('This carries a second action.');
    expect(found?.level).toBe('block');
    expect(compile(two, banana, { rules: [declaredRule(noThen)] }).blocked).toBe(true);
  });

  it('answers the same way twice, whatever flags it was given', () => {
    const sticky = rule({
      id: 'sticky',
      alwaysOn: true,
      check: { kind: 'matches', in: ['text'], pattern: 'slate', flags: 'gi', say: 'slate' },
    });

    const compiled = declaredRule(sticky);
    // A `g` regex kept across calls answers differently every other time; this
    // has to be a property of the rule, not of how often it has run.
    for (let i = 0; i < 4; i += 1) {
      expect(compile(SCENE, banana, { rules: [compiled] }).findings).toHaveLength(1);
    }
  });
});

describe('a field that needs another beside it', () => {
  const pairing = rule({
    id: 'gear-needs-effect',
    level: 'warn',
    alwaysOn: true,
    check: {
      kind: 'requires',
      when: 'optics.gearHint',
      needs: 'optics.effect',
      say: 'A lens number on its own tells a model nothing.',
    },
  });

  it('complains when one is there without the other', () => {
    const [found] = findingsOf(SCENE, pairing, kling);
    expect(found?.message).toContain('lens number on its own');
    expect(found?.path).toBe('optics.gearHint');
  });

  it('is quiet when both are there, and when neither is', () => {
    const both = { ...SCENE, optics: { gearHint: '50mm', effect: 'the room falls away' } };
    expect(findingsOf(both, pairing, kling)).toEqual([]);

    const { optics: _none, ...without } = SCENE;
    expect(findingsOf(without, pairing, kling)).toEqual([]);
  });
});

describe('where a rule applies', () => {
  const videoOnly = rule({
    id: 'video-only',
    alwaysOn: true,
    appliesTo: { modality: ['video'] },
    check: { kind: 'matches', in: ['subject.headline'], pattern: 'bottle', say: 'a bottle' },
  });

  it('runs where it says and nowhere else', () => {
    expect(findingsOf(SCENE, videoOnly)).toEqual([]);
    expect(findingsOf({ ...SCENE, modality: 'video' }, videoOnly, kling)).toHaveLength(1);
  });
});

describe('a rule that will not compile', () => {
  const wontCompile = (over: Partial<DeclaredRule>, because: RegExp) =>
    expect(() => declaredRule(rule(over), 'x.yaml')).toThrow(because);

  it('says which part is wrong rather than that something is', () => {
    wontCompile({ level: 'shout' as never }, /not autofix, warn or block/);
    wontCompile({ rationale: '' }, /no rationale/);
    wontCompile({ check: undefined as never }, /no check, so it does nothing/);
    wontCompile(
      { check: { kind: 'vibes' as never, in: ['text'], words: ['x'] } as never },
      /this build cannot run/,
    );
  });

  it('refuses a check that could never fire', () => {
    wontCompile({ check: { kind: 'forbid-words', in: ['text'], words: [] } }, /forbids no words/);
    wontCompile(
      { check: { kind: 'max-items', in: 'a.b', max: -1 } },
      /is not a count/,
    );
    wontCompile(
      { check: { kind: 'requires', when: '', needs: 'a' } },
      /names no pair of fields/,
    );
  });

  it('refuses a pattern that will not compile, rather than at render time', () => {
    wontCompile(
      { check: { kind: 'matches', in: ['text'], pattern: '([', say: 'x' } },
      /pattern will not compile/,
    );
  });

  it('names what this build can run, so a version gap is obvious', () => {
    try {
      declaredRule(rule({ check: { kind: 'vibes' as never, in: [], words: [] } as never }), 'x');
      expect.unreachable();
    } catch (err) {
      expect((err as DeclaredRuleError).message).toContain('forbid-words, max-items');
    }
  });
});

describe('reading a set of them', () => {
  const good = `
id: no-cheugy
level: warn
rationale: These stopped working in the August checkpoint and now read as noise.
alwaysOn: true
check:
  kind: forbid-words
  in: [text]
  words: [hyperrealistic]
source:
  name: a test
  dated: "2026-08-30"
`;

  it('keeps the ones that load and says why the others did not', () => {
    const { rules, rejected } = parseDeclaredRules([
      { source: 'good.yaml', text: good },
      { source: 'broken.yaml', text: 'this: [is not: valid yaml' },
      { source: 'empty.yaml', text: 'id: nothing\n' },
    ]);

    expect(rules.map((r) => r.id)).toEqual(['no-cheugy']);
    expect(rejected.map((r) => r.source)).toEqual(['broken.yaml', 'empty.yaml']);
    expect(rejected[0]?.reason).toContain('not valid YAML');
  });

  it('produces a rule the ordinary compiler runs, with its source intact', () => {
    const { rules } = parseDeclaredRules([{ source: 'good.yaml', text: good }]);
    const only = rules[0]!;

    expect(only.source?.dated).toBe('2026-08-30');
    expect(only.alwaysOn).toBe(true);

    const { findings } = compile(SCENE, banana, { rules });
    expect(findings[0]?.ruleId).toBe('no-cheugy');
    expect(findings[0]?.fix).toContain('read as noise');
  });

  it('runs beside the rules that ship as code', async () => {
    const { ALL_RULES } = await import('../src/rules/index.ts');
    const { rules } = parseDeclaredRules([{ source: 'good.yaml', text: good }]);

    const together = compile(SCENE, banana, { rules: [...ALL_RULES, ...rules] });
    const ids = together.findings.map((f) => f.ruleId);

    expect(ids).toContain('no-cheugy');
    expect(ids).toContain('max-look-words');
  });
});
