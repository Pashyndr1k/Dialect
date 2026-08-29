import type { Rule } from '../types.ts';

const ID = 'emotions-are-physical';

/**
 * A label asks the model to guess a face. A physical action tells it exactly
 * what to render: not "looks angry" but "jaw clenches, nostrils flare".
 */
const LABELS = [
  'angry', 'sad', 'happy', 'excited', 'nervous', 'anxious', 'afraid', 'scared',
  'surprised', 'disgusted', 'confused', 'bored', 'proud', 'ashamed', 'jealous',
];

// Deliberately narrow: only the giveaway constructions, never a bare mention.
const pattern = new RegExp(
  '\\b(looks?|looking|seems?|appears?|feeling|feels?|with an?)\\s+' +
    '(?:very\\s+|quite\\s+|deeply\\s+)?(' + LABELS.join('|') + ')\\b',
  'i',
);

interface Spot {
  path: string;
  text: string;
}

export const emotionsArePhysical: Rule = {
  id: ID,
  level: 'warn',
  rationale:
    'Emotion words leave the performance to chance. Naming the physical behaviour instead is the ' +
    'difference between a face the model invents and one it renders.',
  source: { name: 'The Prompting Handbook v1.2 (Magnific)', dated: '2026-07-01' },

  onIR(ir) {
    const spots: Spot[] = [];
    if (ir.subject?.action) spots.push({ path: 'subject.action', text: ir.subject.action });
    for (const [i, e] of (ir.subject?.entities ?? []).entries()) {
      if (e.description) {
        spots.push({ path: `subject.entities[${i}].description`, text: e.description });
      }
    }
    for (const [i, b] of (ir.beats ?? []).entries()) {
      spots.push({ path: `beats[${i}].action`, text: b.action });
    }

    const findings = spots.flatMap((s) => {
      const m = pattern.exec(s.text);
      return m
        ? [
            {
              ruleId: ID,
              level: 'warn' as const,
              message: `"${m[0]}" names an emotion instead of showing one.`,
              fix: 'Say what the camera would see: a jaw tightening, a gaze dropping, a slow blink.',
              path: s.path,
            },
          ]
        : [];
    });

    return { ir, findings };
  },
};
