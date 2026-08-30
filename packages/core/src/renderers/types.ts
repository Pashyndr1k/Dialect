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

/**
 * How segments become one prompt.
 *
 * Carried on the result so a consumer can rebuild the text from a *subset* of
 * segments without knowing anything about the dialect. That is what lets the
 * chip editor switch a block off, and what stops rules from having to guess at
 * the joining rules of a form they were not written for.
 */
export interface Assembly {
  separator: string;
  /** Render each segment as `Label: text`, as the field-list dialects do. */
  labelled: boolean;
  /** Drop a trailing full stop before joining, for forms that supply their own. */
  stripTrailingPeriod?: boolean;
  /** Appended once at the end if not already present. */
  terminator?: string;
  /** Segment rendered ahead of the body rather than joined into it. */
  prefixLabel?: string;
  /** Upper-case the first letter of the assembled body. */
  capitalize?: boolean;
}

export interface RenderResult {
  target: string;
  segments: Segment[];
  /** The prompt exactly as it should be pasted into the model. */
  text: string;
  assembly: Assembly;
  /** Only when the profile has a dedicated negative field. */
  negative?: string;
  /** Settings that travel beside the prompt rather than inside it. */
  params: Record<string, string>;
}

/**
 * Rebuild the prompt from whichever segments pass `enabled`. Called by every
 * renderer to produce its own `text`, and by the editor when a chip is toggled.
 */
export function assembleText(
  result: Pick<RenderResult, 'segments' | 'assembly'>,
  enabled: (segment: Segment) => boolean = () => true,
): string {
  const a = result.assembly;
  // A field that resolved to nothing is left out entirely. `Lighting:` with an
  // empty line after it is not a neutral omission — it is a labelled gap, and a
  // model asked to fill one will.
  const kept = result.segments.filter((s) => s.text.trim() !== '' && enabled(s));

  const prefix = a.prefixLabel ? kept.find((s) => s.label === a.prefixLabel) : undefined;
  const body = kept
    .filter((s) => s.label !== a.prefixLabel)
    .map((s) => {
      const t = a.stripTrailingPeriod ? s.text.replace(/\.$/, '') : s.text;
      return a.labelled ? `${s.label}: ${t}` : t;
    })
    .join(a.separator);

  let out = a.capitalize && body ? body.charAt(0).toUpperCase() + body.slice(1) : body;
  if (a.terminator && out && !out.endsWith(a.terminator)) out += a.terminator;
  return prefix ? `${prefix.text} ${out}` : out;
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
