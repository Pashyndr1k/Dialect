/**
 * Turning a template into an IR.
 *
 * The order of merging is the whole design: the inheritance chain from the
 * furthest ancestor down, then the snippets, then the template's own fields,
 * then whatever the caller already had. Each layer can override the one before
 * it, so the person editing the document always wins over the template that
 * produced it.
 */

import { IR_VERSION, type PromptIR } from '../ir/types.ts';
import type { ApplyResult, IRFragment, Library, Template } from './types.ts';
import { MissingVariablesError, TemplateError } from './types.ts';

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Deep merge, with `key+` appending to `key` rather than replacing it.
 *
 * Arrays replace by default: a template that sets three look words means those
 * three, not those three plus whatever it inherited. Appending is opt-in and
 * visible in the source.
 */
export function mergeFragments(base: IRFragment, over: IRFragment): IRFragment {
  const out: IRFragment = { ...base };

  for (const [rawKey, value] of Object.entries(over)) {
    const append = rawKey.endsWith('+');
    const key = append ? rawKey.slice(0, -1) : rawKey;

    if (append) {
      const existing = out[key];
      const before = Array.isArray(existing) ? existing : [];
      const added = Array.isArray(value) ? value : [value];
      out[key] = [...before, ...added.filter((v) => !before.includes(v))];
      continue;
    }

    // An object is always merged, even into an empty slot: assigning it whole
    // would carry any nested `key+` markers through unresolved.
    const existing = out[key];
    out[key] = isPlainObject(value)
      ? mergeFragments(isPlainObject(existing) ? existing : {}, value)
      : value;
  }

  return out;
}

/** Every `{{name}}` in the fragment, in the order it first appears. */
export function variablesIn(fragment: IRFragment): string[] {
  const found: string[] = [];

  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const m of value.matchAll(PLACEHOLDER)) {
        const name = m[1];
        if (name && !found.includes(name)) found.push(name);
      }
      return;
    }
    if (Array.isArray(value)) value.forEach(walk);
    else if (isPlainObject(value)) Object.values(value).forEach(walk);
  };

  walk(fragment);
  return found;
}

function substitute(fragment: IRFragment, values: Record<string, string>): IRFragment {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole);
    }
    if (Array.isArray(value)) return value.map(walk);
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };

  return walk(fragment) as IRFragment;
}

/** Furthest ancestor first, so the child merges over it. */
export function chainFor(library: Library, id: string): Template[] {
  const chain: Template[] = [];
  const seen = new Set<string>();

  let current: string | undefined = id;
  while (current) {
    if (seen.has(current)) {
      throw new TemplateError(
        `Template "${id}" extends itself through ${[...seen].join(' -> ')} -> ${current}.`,
      );
    }
    seen.add(current);

    const template: Template | undefined = library.templates.get(current);
    if (!template) {
      throw new TemplateError(
        `No template named "${current}"${current === id ? '' : `, extended by "${id}"`}. ` +
          `Known: ${[...library.templates.keys()].join(', ') || '(none)'}.`,
      );
    }
    chain.unshift(template);
    current = template.extends;
  }

  return chain;
}

export interface ApplyOptions {
  /** Values for the template's variables. */
  values?: Record<string, string>;
  /**
   * An IR to build on. Merged last, so a document already in hand keeps its
   * own fields where they disagree with the template.
   */
  onto?: PromptIR;
}

export function applyTemplate(
  library: Library,
  id: string,
  options: ApplyOptions = {},
): ApplyResult {
  const chain = chainFor(library, id);
  const leaf = chain[chain.length - 1]!;

  let fragment: IRFragment = {};

  for (const template of chain) {
    for (const snippetId of template.snippets ?? []) {
      const snippet = library.snippets.get(snippetId);
      if (!snippet) {
        throw new TemplateError(
          `Template "${template.id}" asks for snippet "${snippetId}", which is not in the library. ` +
            `Known: ${[...library.snippets.keys()].join(', ') || '(none)'}.`,
        );
      }
      if (snippet.appliesTo && !snippet.appliesTo.includes(leaf.modality)) continue;
      fragment = mergeFragments(fragment, snippet.ir);
    }
    fragment = mergeFragments(fragment, template.ir);
  }

  // Defaults come from the whole chain, so a parent can define a variable a
  // child leaves alone.
  const declared = chain.flatMap((t) => t.variables ?? []);
  const values: Record<string, string> = {};
  for (const variable of declared) {
    const given = options.values?.[variable.name];
    const value = given?.trim() ? given.trim() : variable.default;
    if (value !== undefined) values[variable.name] = value;
  }
  for (const [name, value] of Object.entries(options.values ?? {})) {
    if (value.trim()) values[name] = value.trim();
  }

  const needed = variablesIn(fragment);
  const missing = needed.filter((name) => values[name] === undefined);
  if (missing.length > 0) throw new MissingVariablesError(id, missing);

  const filled = substitute(fragment, values);

  const base: PromptIR = options.onto ?? {
    irVersion: IR_VERSION,
    modality: leaf.modality,
    mode: 'generate',
  };

  const ir = mergeFragments(
    filled as IRFragment,
    base as unknown as IRFragment,
  ) as unknown as PromptIR;

  return { ir: { ...ir, irVersion: IR_VERSION }, used: values };
}
