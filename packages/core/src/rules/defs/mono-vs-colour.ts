import type { Rule } from '../types.ts';

const ID = 'mono-vs-colour';

/**
 * A claim that the picture has no colour.
 *
 * Sepia and duotone count: they are one hue, so a second one contradicts them
 * the same way. Deliberately not matching "desaturated" or "muted", which are
 * degrees rather than a claim that colour is absent.
 */
const MONO =
  /\b(?:monochrome|monochromatic|black[- ]and[- ]white|black ?& ?white|b\s?&\s?w|greyscale|grayscale|duotone|two[- ]tone|sepia)\b/i;

/**
 * A claim that it does have colour, and which.
 *
 * Named hues, and the processes that exist to produce impossible colour. A
 * grade that only says "warm" or "high contrast" is not a contradiction: a
 * monochrome image can be warm.
 */
const COLOUR =
  /\b(?:false[- ]colou?r|ironbow|full[- ]colou?r|technicolor|saturated|chroma|red|orange|amber|yellow|green|cyan|teal|blue|indigo|violet|purple|magenta|pink|ochre|umber|crimson|scarlet|emerald|azure)\b/i;

const said = (text: string | undefined, pattern: RegExp): boolean =>
  text ? pattern.test(text) : false;

/**
 * One picture cannot be both colourless and coloured.
 *
 * This turns up when a document is varied: the look axis rewrites the grade and
 * the medium, and a colour claim left in another field — usually the genre —
 * survives to contradict the new one. A live run produced "Minimalist
 * monochrome character study" alongside "Ironbow false colour" and alongside
 * "punched saturated reversal, orange-tungsten skin", in the same prompt.
 *
 * Warned rather than fixed, because which half is wanted is the author's call:
 * the genre may be the mistake, or the new grade may be.
 */
export const monoVsColour: Rule = {
  id: ID,
  level: 'warn',
  // A prompt that contradicts itself is wrong for every model, so no card has
  // to remember to ask for this.
  alwaysOn: true,
  rationale:
    'A prompt that says both cannot be satisfied, so the model picks one and the choice is not ' +
    'the author’s. It is the commonest contradiction a varied document produces, because an ' +
    'axis rewrites some look fields and leaves the rest.',
  source: { name: 'The Prompting Handbook v1.2 (Magnific)', dated: '2026-07-01' },

  onIR(ir) {
    const fields: Array<{ path: string; text: string | undefined }> = [
      { path: 'style.genre', text: ir.style?.genre },
      { path: 'style.medium', text: ir.style?.medium },
      { path: 'palette.grade', text: ir.palette?.grade },
      { path: 'palette.saturation', text: ir.palette?.saturation },
      { path: 'lighting.colorTemp', text: ir.lighting?.colorTemp },
    ];

    const mono = fields.filter((f) => said(f.text, MONO));
    if (mono.length === 0) return { ir, findings: [] };

    // A named hue in the palette counts too: listing colours is a colour claim
    // however the grade is worded.
    const colour = fields.filter((f) => said(f.text, COLOUR));
    const hues = (ir.palette?.dominant ?? []).filter((h) => h.trim());
    if (colour.length === 0 && hues.length === 0) return { ir, findings: [] };

    const first = mono[0]!;
    const other = colour[0];
    return {
      ir,
      findings: [
        {
          ruleId: ID,
          level: 'warn' as const,
          message:
            `${first.path} says the picture has no colour, and ` +
            `${other ? `${other.path} says it does` : `${hues.length} colour(s) are named in the palette`}.`,
          fix: other
            ? `Drop the colourless claim from ${first.path}, or change ${other.path} back to a single hue.`
            : `Drop the colourless claim from ${first.path}, or clear palette.dominant.`,
          path: first.path,
        },
      ],
    };
  },
};
