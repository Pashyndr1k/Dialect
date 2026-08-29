/**
 * Templates and snippets.
 *
 * A template is a partially filled IR with holes in it, not a prompt. That is
 * what lets one template serve every target: it produces an IR, and the
 * dialects take it from there.
 *
 * A snippet is a fragment worth reusing across templates — the film-look line,
 * the standard negatives, the skin-realism block. Both are the same shape, and
 * both are files, so either can be edited, versioned and shared.
 */

import type { Modality, PromptIR } from '../ir/types.ts';

export interface Variable {
  name: string;
  label?: string;
  /** Shown under the field. Say what good input looks like, not what it is. */
  hint?: string;
  default?: string;
  required?: boolean;
}

/**
 * A partial IR. String values may contain `{{name}}` holes, and a key ending in
 * `+` appends to the array below it instead of replacing it — one character of
 * syntax, so a snippet can add to a list a template already started.
 */
export type IRFragment = Record<string, unknown>;

export interface Snippet {
  id: string;
  name: string;
  description?: string;
  /** Restrict to modalities where the fragment makes sense. */
  appliesTo?: Modality[];
  ir: IRFragment;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  modality: Modality;
  /** Id of a template to build on. Its IR is merged first, so this one wins. */
  extends?: string;
  variables?: Variable[];
  /** Snippet ids, merged before this template's own `ir`. */
  snippets?: string[];
  ir: IRFragment;
  source?: { name: string; dated: string };
}

export interface Library {
  templates: Map<string, Template>;
  snippets: Map<string, Snippet>;
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

export class MissingVariablesError extends TemplateError {
  readonly missing: string[];
  constructor(templateId: string, missing: string[]) {
    super(
      `Template "${templateId}" still needs ${missing.join(', ')}. ` +
        `Fill ${missing.length === 1 ? 'it' : 'them'} in, or give the variable a default.`,
    );
    this.name = 'MissingVariablesError';
    this.missing = missing;
  }
}

export interface ApplyResult {
  ir: PromptIR;
  /** Variables that were used, with the value each resolved to. */
  used: Record<string, string>;
}
