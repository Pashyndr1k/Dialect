/**
 * What a call costs, roughly, in one place.
 *
 * It was in three, and they disagreed: the batch priced reading a reference at
 * seven cents while the composer priced the same call at two, so the same image
 * cost differently depending on which button you reached for.
 *
 * Rough is fine — the number is there so nobody is surprised, not so anybody can
 * do accounting with it.
 *
 * These were measured against Opus, then scaled when the default model became
 * Sonnet: the published rates are two fifths of Opus on both input and output,
 * so the figures are two fifths of what was measured. That is arithmetic, not a
 * measurement — the token counts should be the same but nothing here has
 * watched a Sonnet run yet. The first one that happens should correct them.
 */

/** Reading a reference: one call carrying pictures. */
export const PER_READ_USD = 0.02;

/** Composing, varying, filling a template: text in, text out. */
export const PER_WRITE_USD = 0.004;

/** What one press will cost: the references not yet read, plus the writing. */
export const estimate = (unread: number, composes: boolean): number =>
  unread * PER_READ_USD + (composes ? PER_WRITE_USD : 0);

/** Pennies, for a label. Rounded up, because a low guess is the bad surprise. */
export const roughly = (usd: number): string =>
  usd < 0.01 ? 'under 1c' : `about ${Math.ceil(usd * 100)}c`;
