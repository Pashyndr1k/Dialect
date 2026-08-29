import type { Rule } from '../types.ts';

const ID = 'one-action-one-move';

/** Conjunctions that betray a second action smuggled into one clip. */
const SPLITTERS = /(,\s*then\s|\sand\s+then\s|\sthen\s|;\s|\sbefore\s+turning\s|\safter\s+which\s)/i;

/**
 * Stacking actions or camera moves inside a single clip is the most common
 * cause of warping and instability. The second action belongs in the next shot.
 */
export const oneActionOneMove: Rule = {
  id: ID,
  level: 'block',
  rationale:
    'Video engines execute one intent per clip. A second action or a second camera move makes ' +
    'the model interpolate between them, which is where limbs bend the wrong way.',
  source: { name: 'The Prompting Handbook v1.2 (Magnific)', dated: '2026-07-01' },

  appliesTo: (ir) => ir.modality === 'video' && ir.mode === 'generate',

  onIR(ir) {
    const findings = [];
    const action = ir.subject?.action ?? '';

    if (action && SPLITTERS.test(action)) {
      findings.push({
        ruleId: ID,
        level: 'block' as const,
        message: 'This clip carries more than one action.',
        fix: 'Keep the first action here and move the rest into the next shot.',
        path: 'subject.action',
      });
    }

    // Beats are the sanctioned way to choreograph several moments: one action
    // each, on a timecode. They are not a second action in the same sentence.
    const detail = ir.cameraMove?.detail ?? '';
    if (detail && SPLITTERS.test(detail)) {
      findings.push({
        ruleId: ID,
        level: 'block' as const,
        message: 'This clip carries more than one camera move.',
        fix: 'Pick the move that matters and cut to a new shot for the other.',
        path: 'cameraMove.detail',
      });
    }

    return { ir, findings };
  },
};
