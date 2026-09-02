/**
 * What to call a prompt when it becomes a file.
 *
 * Here rather than in either front end, because both save prompts and a name
 * that differs between them is a name someone has to think about twice. A
 * string is not a filesystem, so this stays inside core's no-platform rule.
 */

import type { CompileResult } from '../compile.ts';

const tidy = (s: string): string => s.replace(/[^\w. -]+/g, '-').trim().slice(0, 60);

/**
 * The document's title first, because that is what a person looks for.
 *
 * One document rendered for three models is three prompts with one title, so a
 * clash is broken with the model — the thing that actually differs. A number is
 * the last resort and says nothing about what is in the file.
 *
 * `taken` is carried between calls and added to, so a set of prompts saved
 * together cannot overwrite each other. Two of them did.
 */
export function promptFileName(
  prompt: Pick<CompileResult, 'ir' | 'profile'>,
  index: number,
  taken: Set<string>,
): string {
  const title = tidy(prompt.ir.title?.trim() || `prompt-${index}`) || `prompt-${index}`;
  const candidates = [title, `${title} - ${tidy(prompt.profile.id)}`, `${title} ${index}`];

  for (const candidate of candidates) {
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return `${candidate}.txt`;
    }
  }

  const last = `${title} ${index}`;
  taken.add(last);
  return `${last}.txt`;
}
