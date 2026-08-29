import type { Rule } from '../types.ts';

const ID = 'max-tracked-entities';
const LIMIT = 3;

/**
 * Past three tracked identities, engines start swapping them: faces migrate
 * between bodies and wardrobe details trade places across cuts.
 */
export const maxTrackedEntities: Rule = {
  id: ID,
  level: 'warn',
  rationale:
    'Identity tracking degrades sharply beyond three characters. Extras should stay generic and ' +
    'unnamed so the model spends its attention on the ones that must stay recognisable.',
  source: { name: 'The Prompting Handbook v1.2 (Magnific)', dated: '2026-07-01' },

  appliesTo: (ir) => ir.modality === 'video',

  onIR(ir) {
    const entities = ir.subject?.entities ?? [];
    // Anything with a detailed description is tracked unless explicitly waived.
    const tracked = entities.filter((e) => e.tracked ?? Boolean(e.description));
    if (tracked.length <= LIMIT) return { ir, findings: [] };

    const extra = tracked.slice(LIMIT).map((e) => e.name);
    return {
      ir,
      findings: [
        {
          ruleId: ID,
          level: 'warn' as const,
          message: `${tracked.length} characters are described in detail; identities start swapping past ${LIMIT}.`,
          fix: `Keep detail on the first ${LIMIT} and let ${extra.join(', ')} stay generic.`,
          path: 'subject.entities',
        },
      ],
    };
  },
};
