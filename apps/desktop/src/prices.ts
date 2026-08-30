/**
 * What a call costs, roughly, in one place.
 *
 * It was in three, and they disagreed: the batch priced reading a reference at
 * seven cents while the composer priced the same call at two, so the same image
 * cost differently depending on which button you reached for.
 *
 * Rough is fine — the number is there so nobody is surprised, not so anybody can
 * do accounting with it. The reading figure is the one live extraction this
 * project has actually measured, rounded up; the composing figure is smaller
 * because that call carries no picture.
 */

export const PER_READ_USD = 0.05;
export const PER_WRITE_USD = 0.01;

/** What one press will cost: the references not yet read, plus the writing. */
export const estimate = (unread: number, composes: boolean): number =>
  unread * PER_READ_USD + (composes ? PER_WRITE_USD : 0);
