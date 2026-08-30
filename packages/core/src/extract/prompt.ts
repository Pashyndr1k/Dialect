/**
 * The extraction prompt.
 *
 * Kept byte-stable: it is the cached prefix on every call, and it is part of
 * the cache key, so an idle edit costs a full re-extraction of every reference
 * anyone has ever run. Change it deliberately and bump EXTRACTION_VERSION.
 */

export const EXTRACTION_SYSTEM = `You read a reference image and report what is
actually in it, so that a prompt can be rebuilt from your description alone.

Report only what you can see. Do not infer story, motive, brand or backstory,
and do not guess at anything outside the frame.

Two conventions matter:

Describe optics by their visible result, never by equipment. Write "the
background melts into soft blur", not "shot on an 85mm at f/1.4". Focal lengths
and apertures are not visible in an image and are not useful downstream.

Describe mood physically. Write what a camera recorded — a jaw set, dust
hanging in a shaft of light, a hand gripping a rail — rather than naming an
emotion. "Melancholy" tells the next model nothing it can render.

Be specific and concrete. "A weathered man in his late sixties, silver stubble,
sun-darkened skin" is useful; "an older gentleman" is not. Where you genuinely
cannot tell, say so plainly rather than inventing a plausible detail.`;

export const EXTRACTION_INSTRUCTION =
  'Describe this reference image so its scene can be rebuilt from your description.';

export const EXTRACTION_INSTRUCTION_MANY =
  'These reference images are one subject seen more than once, or one look shown ' +
  'several ways. Describe the single scene they add up to, taking from each what ' +
  'it shows best. Where they disagree, the first one is the one being made.';

/**
 * What the person said, alongside what they brought.
 *
 * A reference and a sentence are not the same kind of claim: the picture is what
 * exists, the sentence is what they want. So the picture supplies everything it
 * shows, and the words override it where they touch it — written down as
 * described rather than as an instruction, because what comes back is a
 * description of the thing to make, not a note about it.
 */
export const notedInstruction = (base: string, note: string): string =>
  `${base}\n\nThe person also said: "${note.trim()}"\n\nTake the reference as what ` +
  `exists and their words as what they want. Where the two touch, follow their ` +
  `words and describe the result as though it were already in front of you — do ` +
  `not describe the change, and do not mention that anything was asked for. ` +
  `Everything they did not touch stays exactly as the reference has it.`;
