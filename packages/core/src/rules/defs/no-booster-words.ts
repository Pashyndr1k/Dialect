import { assembleText } from '../../renderers/types.ts';
import type { Rule } from '../types.ts';

const ID = 'no-booster-words';

/**
 * Boosters summon exactly the processed, over-sharpened look they promise to
 * prevent. Grain is the one film artifact worth keeping; scratches, dust and
 * "old damaged film" belong on the same list as the rest.
 */
const BANNED = [
  'ultra sharp',
  'ultra-sharp',
  'hyper detailed',
  'hyper-detailed',
  'razor sharp',
  'razor-sharp',
  'crisp',
  '8k clarity',
  '8k',
  'hdr',
  'ultra-realistic detail',
  'ultra realistic detail',
  'masterpiece',
  'old damaged film',
];

const pattern = new RegExp(
  `(^|[\\s,;:])(${BANNED.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[\\s,;.:])`,
  'gi',
);

export const noBoosterWords: Rule = {
  id: ID,
  level: 'autofix',
  alwaysOn: true,
  rationale:
    'Quality boosters push models toward the plastic, over-sharpened default. Removing them ' +
    'reliably improves the render, so they are stripped rather than merely flagged.',
  source: { name: 'The Prompting Handbook v1.2 (Magnific)', dated: '2026-07-01' },

  onText(result) {
    const hits = new Set<string>();

    const strip = (s: string): string =>
      s
        .replace(pattern, (_m, lead: string, word: string) => {
          hits.add(word.toLowerCase());
          return lead;
        })
        // Collapse the punctuation left behind by a removed list item.
        .replace(/\s*,\s*,/g, ',')
        .replace(/,\s*([.;])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.;])/g, '$1')
        .replace(/(^[\s,]+)|([\s,]+$)/g, '')
        .trim();

    const segments = result.segments.map((seg) => {
      const text = strip(seg.text);
      return text === seg.text ? seg : { ...seg, text, source: 'rule' as const, ruleId: ID };
    });

    if (hits.size === 0) return { result, findings: [] };

    const negative = result.negative === undefined ? undefined : strip(result.negative);
    // Rebuild through the result's own assembly rules: this rule runs against
    // every dialect and must not impose one form's joining on another.
    const text = assembleText({ segments, assembly: result.assembly });

    const fixed = { ...result, segments, text };
    if (negative !== undefined) fixed.negative = negative;

    return {
      result: fixed,
      findings: [
        {
          ruleId: ID,
          level: 'autofix',
          message: `Removed booster words that degrade the render: ${[...hits].join(', ')}.`,
          fix: 'Name the visible effect you want instead, e.g. "fine uniform film grain".',
        },
      ],
    };
  },
};
