/**
 * The saved artefact, as opposed to the prompt.
 *
 * `RenderResult.text` is what gets pasted into the model. A document is what a
 * human keeps on disk: a title line, the fields, and the settings that travel
 * beside the prompt rather than inside it.
 */

import type { ModelProfile } from '../registry/types.ts';
import type { RenderResult } from './types.ts';

export interface DocumentOptions {
  /** Shot title for the header line. Absent or undefined means header only. */
  title?: string | undefined;
}

export function toDocument(
  result: RenderResult,
  profile: ModelProfile,
  options: DocumentOptions = {},
): string {
  const blocks: string[] = [];

  const header = profile.header ?? `${profile.label} prompt`;
  blocks.push(options.title ? `${header} — ${options.title}` : header);

  blocks.push(result.text);

  if (result.negative) blocks.push(`Negative: ${result.negative}`);

  const settings = Object.entries(result.params);
  if (settings.length > 0) {
    blocks.push(['Suggested settings:', ...settings.map(([k, v]) => `- ${k}: ${v}`)].join('\n'));
  }

  return blocks.join('\n\n') + '\n';
}
