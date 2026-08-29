import type { Rule } from '../types.ts';

const ID = 'exit-frame-means-gone';

/** Leaving frame. */
const EXIT =
  /\b(exits?|leaves?|walks? out of|steps? out of|disappears? from)\s+(the\s+)?(frame|shot)\b/i;
/** Coming back inside the same continuous take. */
const RETURN = /\b(re-?enters?|returns?|comes? back|steps? back in|walks? back in|reappears?)\b/i;

/**
 * Off-screen means nonexistent. Anything that leaves the frame is gone for the
 * rest of that shot, so an exit followed by a return inside one continuous take
 * cannot render — it needs a cut.
 */
export const exitFrameMeansGone: Rule = {
  id: ID,
  level: 'block',
  rationale:
    'The engine holds no state for what it cannot see. An exit and a re-entry in one take gives ' +
    'you a different person walking back in, or nothing at all.',
  source: { name: 'The Prompting Handbook v1.2 (Magnific)', dated: '2026-07-01' },

  appliesTo: (ir) => ir.modality === 'video',

  onIR(ir) {
    // Beats are one continuous take by definition, so they are read together
    // with the action line rather than separately.
    const timeline = [ir.subject?.action ?? '', ...(ir.beats ?? []).map((b) => b.action)].join(' ');

    const exit = EXIT.exec(timeline);
    if (!exit) return { ir, findings: [] };

    const after = timeline.slice(exit.index + exit[0].length);
    if (!RETURN.test(after)) return { ir, findings: [] };

    return {
      ir,
      findings: [
        {
          ruleId: ID,
          level: 'block' as const,
          message: 'Something leaves the frame and comes back inside one continuous take.',
          fix: 'Cut to a new shot for the return, or keep them in frame throughout.',
          path: 'subject.action',
        },
      ],
    };
  },
};
