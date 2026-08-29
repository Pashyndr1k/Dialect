import type { PromptIR } from '../ir/types.ts';
import type { ModelProfile } from '../registry/types.ts';

/** Where a piece of the final prompt came from. Drives the source map in the editor. */
export type SegmentSource = 'ir' | 'template' | 'rule' | 'manual';

/**
 * One addressable piece of the final prompt. The chip editor renders these
 * directly: each can be reordered, switched off, weighted or locked, and each
 * knows the IR path to jump to when the user clicks it.
 */
export interface Segment {
  /** Dialect field name, e.g. `Subject`. */
  label: string;
  /** IR paths that fed this segment. */
  from: string[];
  text: string;
  source: SegmentSource;
  /** Set when a rule wrote or rewrote this segment. */
  ruleId?: string;
}

export interface RenderResult {
  target: string;
  segments: Segment[];
  /** The prompt exactly as it should be pasted into the model. */
  text: string;
  /** Only when the profile has a dedicated negative field. */
  negative?: string;
  /** Settings that travel beside the prompt rather than inside it. */
  params: Record<string, string>;
}

export type Renderer = (ir: PromptIR, profile: ModelProfile) => RenderResult;

export class RendererError extends Error {
  constructor(rendererId: string, detail: string) {
    super(`Renderer "${rendererId}" cannot render this: ${detail}`);
    this.name = 'RendererError';
  }
}

/** Join prose fragments, dropping the empty ones, without leaving stray separators. */
export function joinParts(parts: Array<string | undefined | null>, sep = ', '): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0)
    .join(sep);
}
