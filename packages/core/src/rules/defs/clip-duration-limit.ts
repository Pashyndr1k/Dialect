import type { Rule } from '../types.ts';

const ID = 'clip-duration-limit';

/**
 * The one rule here needing no heuristics: the profile states the longest clip
 * the model will produce, and the IR states how long this one is.
 */
export const clipDurationLimit: Rule = {
  id: ID,
  level: 'block',
  alwaysOn: true,
  rationale:
    'Asking for a longer clip than the model generates does not stretch it, it truncates or ' +
    'degrades. Longer sequences are chained as separate shots instead.',

  appliesTo: (ir) => ir.modality === 'video',

  onIR(ir, profile) {
    const asked = ir.shot?.durationS;
    const cap = profile.limits?.durationS;
    if (asked === undefined || cap === undefined || asked <= cap) return { ir, findings: [] };

    return {
      ir,
      findings: [
        {
          ruleId: ID,
          level: 'block' as const,
          message: `${asked}s exceeds what ${profile.label} generates in one clip (${cap}s).`,
          fix: `Shorten this shot to ${cap}s or less, or split it and chain the clips.`,
          path: 'shot.durationS',
        },
      ],
    };
  },
};
