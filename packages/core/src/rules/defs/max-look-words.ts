import type { Rule } from '../types.ts';

const ID = 'max-look-words';
const LIMIT = 3;

/**
 * Stacked look words dilute each other, and the strongest one stops landing.
 * Two or three is the working range.
 */
export const maxLookWords: Rule = {
  id: ID,
  level: 'warn',
  rationale:
    'Mood and grade words compete for the same signal. Past three, adding another does not ' +
    'strengthen the look, it weakens the one that was working.',
  source: { name: 'The Prompting Handbook v1.2 (Magnific)', dated: '2026-07-01' },

  onIR(ir) {
    const words = [...(ir.lighting?.lookWords ?? []), ...(ir.style?.notes ?? [])];
    if (words.length <= LIMIT) return { ir, findings: [] };

    const keep = words.slice(0, LIMIT);
    const drop = words.slice(LIMIT);
    return {
      ir,
      findings: [
        {
          ruleId: ID,
          level: 'warn' as const,
          message:
            `${words.length} look words are competing; past ${LIMIT} they cancel each other out.`,
          fix: `Keep ${keep.join(', ')} and drop ${drop.join(', ')}.`,
          path: 'lighting.lookWords',
        },
      ],
    };
  },
};
