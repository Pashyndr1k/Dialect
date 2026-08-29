import type { Rule } from '../types.ts';

const ID = 'only-visible-and-audible';

/**
 * The prompt describes a camera feed. Smells, thoughts and backstory render as
 * nothing at all, so they either become visible evidence or come out.
 */
const pattern =
  /\b(smells? of|the smell of|scent of|thinks?|thinking about|remembers?|remembering|knows? that|used to be|wonders?|hopes? that)\b/i;

interface Spot {
  path: string;
  text: string;
}

export const onlyVisibleAndAudible: Rule = {
  id: ID,
  level: 'warn',
  rationale:
    'Anything the camera cannot see and the microphone cannot hear costs prompt space and returns ' +
    'nothing. Translated into an object or an action, the same idea renders.',
  source: { name: 'The Prompting Handbook v1.2 (Magnific)', dated: '2026-07-01' },

  onIR(ir) {
    const spots: Spot[] = [];
    if (ir.subject?.action) spots.push({ path: 'subject.action', text: ir.subject.action });
    if (ir.environment?.description) {
      spots.push({ path: 'environment.description', text: ir.environment.description });
    }
    if (ir.mood?.atmosphere) spots.push({ path: 'mood.atmosphere', text: ir.mood.atmosphere });

    const findings = spots.flatMap((s) => {
      const m = pattern.exec(s.text);
      return m
        ? [
            {
              ruleId: ID,
              level: 'warn' as const,
              message: `"${m[0]}" describes something the camera cannot record.`,
              fix: 'Give it physical evidence in frame: cedar shavings on the bench, dust in the light.',
              path: s.path,
            },
          ]
        : [];
    });

    return { ir, findings };
  },
};
