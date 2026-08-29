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
