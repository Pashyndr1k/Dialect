import type { Rule } from '../types.ts';

const ID = 'gear-needs-effect';

/**
 * Focal lengths and apertures barely register: models do not differentiate
 * 35mm from 85mm, or f/1.2 from f/8. What they respond to is the visible
 * result. So a gear number either travels with its effect, or it does not
 * travel at all.
 */
export const gearNeedsEffect: Rule = {
  id: ID,
  level: 'autofix',
  alwaysOn: true,
  rationale:
    'A lens number on its own is a dead lever. Paired with the effect it is shorthand; alone on a ' +
    'model that ignores it, it is noise taking up prompt space.',
  source: { name: 'The Prompting Handbook v1.2 (Magnific)', dated: '2026-07-01' },

  onIR(ir, profile) {
    const hint = ir.optics?.gearHint;
    if (!hint) return { ir, findings: [] };

    const emits = profile.supports?.emitsGearNumbers ?? false;
    const effect = ir.optics?.effect;

    if (!emits) {
      const optics = { ...ir.optics };
      delete optics.gearHint;

      const finding = {
        ruleId: ID,
        level: 'autofix' as const,
        message: `Dropped "${hint}": ${profile.label} does not differentiate lens numbers.`,
        path: 'optics.gearHint',
        // Only worth suggesting when there is no effect language to fall back on.
        ...(effect
          ? {}
          : { fix: 'Describe the visible effect instead, e.g. "background melts into soft blur".' }),
      };

      return { ir: { ...ir, optics }, findings: [finding] };
    }

    if (!effect) {
      return {
        ir,
        findings: [
          {
            ruleId: ID,
            level: 'warn' as const,
            message: `"${hint}" is carrying the optics on its own, which is a weak lever.`,
            fix: 'Add the visible effect you are actually after alongside it.',
            path: 'optics.effect',
          },
        ],
      };
    }

    return { ir, findings: [] };
  },
};
