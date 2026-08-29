import type { Rule } from '../types.ts';

const ID = 'skin-realism-block';

/** Where retouching shows: a face large in frame. */
const CLOSE = new Set(['close-up', 'extreme-close-up', 'medium-close']);

/**
 * Wherever skin is visible and nothing says otherwise, models smooth it to
 * plastic. Saying it is tactile and real costs one clause and fixes it.
 */
export const skinRealismBlock: Rule = {
  id: ID,
  level: 'autofix',
  rationale:
    'The retouched default is a large part of what makes a render read as generated. This is the ' +
    'cheapest single correction available, so it is applied rather than suggested.',
  source: { name: 'The Prompting Handbook v1.2 (Magnific)', dated: '2026-07-01' },

  onIR(ir) {
    // An explicit false is a deliberate choice and is left alone.
    if (ir.texture?.skinBlock !== undefined) return { ir, findings: [] };

    const hasPerson = (ir.subject?.entities ?? []).some((e) => e.type === 'person');
    if (!hasPerson) return { ir, findings: [] };

    // Stills are where it shows most; in video, only when the face is close.
    const size = ir.shot?.size;
    const closeEnough = ir.modality === 'image' || (size !== undefined && CLOSE.has(size));
    if (!closeEnough) return { ir, findings: [] };

    return {
      ir: { ...ir, texture: { ...ir.texture, skinBlock: true } },
      findings: [
        {
          ruleId: ID,
          level: 'autofix' as const,
          message: 'Added the skin-realism block: skin is visible and nothing was holding it back from plastic.',
          fix: 'Set texture.skinBlock to false if the retouched look is deliberate.',
          path: 'texture.skinBlock',
        },
      ],
    };
  },
};
