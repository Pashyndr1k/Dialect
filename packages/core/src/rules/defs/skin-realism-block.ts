import type { Rule } from '../types.ts';

const ID = 'skin-realism-block';

/** Where retouching shows: a face large in frame. */
const CLOSE = new Set(['close-up', 'extreme-close-up', 'medium-close']);

/**
 * Ways of making a picture that have no skin to retouch.
 *
 * The block exists to stop a *photographic* model smoothing a face to plastic.
 * Asked of a charcoal study, a cel-animated cartoon or a thermal capture it is
 * worse than useless: it fights the medium, demanding pores on a figure the
 * same document describes as flat matte clay. Found on a live run where all
 * eight variations carried it.
 */
const NOT_PHOTOGRAPHIC =
  /\b(?:drawing|drawn|sketch|charcoal|chalk|pencil|graphite|ink|etching|engraving|woodcut|linocut|riso(?:graph)?|screen ?print|lithograph|paint(?:ed|ing)?|oil|acrylic|gouache|watercolou?r|impasto|pastel|illustration|illustrated|cartoon|anime|animation|animated|cel|claymation|stop.?motion|render(?:ed|ing)?|3d|cgi|low.?poly|voxel|pixel art|vector|collage|papercut|sculpture|statue|thermal|infrared|x.?ray|schematic|diagram|blueprint|woodblock)\b/i;

/**
 * Whether anything in the document says this is not a photograph.
 *
 * Read from the whole look rather than one field, because the claim lands
 * wherever the composer put it — the medium usually, the genre often, and the
 * grade when the process is the grade ("two-colour riso").
 */
const looksHandmade = (parts: Array<string | undefined>): boolean =>
  parts.some((p) => (p ? NOT_PHOTOGRAPHIC.test(p) : false));

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

    // A person in a painting is not a person with skin in the photographic
    // sense. Nothing is reported: the block simply does not apply, and a
    // finding here would be noise on every illustration ever written.
    if (
      looksHandmade([
        ir.style?.medium,
        ir.style?.genre,
        ir.palette?.grade,
        ...(ir.style?.notes ?? []),
      ])
    ) {
      return { ir, findings: [] };
    }

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
