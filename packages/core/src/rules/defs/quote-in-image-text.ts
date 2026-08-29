import type { Finding, Rule } from '../types.ts';

const ID = 'quote-in-image-text';
const MAX_ELEMENTS = 3;

/**
 * Text is drawn, not typeset. Models place words the way a designer places
 * them, so each one has to be quoted exactly and given a zone — and there can
 * only be a few before they stop being letterforms at all.
 */
export const quoteInImageText: Rule = {
  id: ID,
  level: 'warn',
  alwaysOn: true,
  rationale:
    'Unquoted words are read as a theme and get paraphrased. Many small labels degrade into ' +
    'shapes. Both failures are invisible until the render comes back wrong.',
  source: { name: 'The Prompting Handbook v1.2 (Magnific)', dated: '2026-07-01' },

  onIR(ir) {
    const entries = ir.textInImage ?? [];
    if (entries.length === 0) return { ir, findings: [] };

    const findings: Finding[] = [];

    // The renderer supplies the quotation marks. Quotes already in the string
    // would come back doubled, so they are stripped here rather than at render.
    let changed = false;
    const cleaned = entries.map((t) => {
      const exact = t.exact.replace(/^["\u201c\u201d']+|["\u201c\u201d']+$/g, '');
      if (exact !== t.exact) changed = true;
      return { ...t, exact };
    });

    if (changed) {
      findings.push({
        ruleId: ID,
        level: 'autofix',
        message: 'Removed quotation marks already around in-image text; the renderer adds its own.',
        path: 'textInImage',
      });
    }

    const unplaced = cleaned.filter((t) => !t.placement);
    if (unplaced.length > 0) {
      findings.push({
        ruleId: ID,
        level: 'warn',
        message: `${unplaced.length} text element(s) have no position, so the model picks one.`,
        fix: 'Brief the zone the way a designer would, e.g. "headline across the top".',
        path: 'textInImage',
      });
    }

    if (cleaned.length > MAX_ELEMENTS) {
      findings.push({
        ruleId: ID,
        level: 'warn',
        message: `${cleaned.length} separate text elements; past ${MAX_ELEMENTS} they degrade into shapes.`,
        fix: 'Keep the few that carry the message and set the rest as type afterwards.',
        path: 'textInImage',
      });
    }

    return { ir: changed ? { ...ir, textInImage: cleaned } : ir, findings };
  },
};
