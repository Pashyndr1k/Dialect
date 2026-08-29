import { parse as parseYaml } from 'yaml';
import type { Library, Snippet, Template } from './types.ts';
import { TemplateError } from './types.ts';

export interface SourceFile {
  source: string;
  text: string;
}

function parseDoc<T>(text: string, source: string, required: readonly string[]): T {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new TemplateError(`${source} is not valid YAML: ${(err as Error).message}`);
  }
  if (raw === null || typeof raw !== 'object') {
    throw new TemplateError(`${source} is empty or not a mapping.`);
  }
  const doc = raw as Record<string, unknown>;
  const missing = required.filter((k) => doc[k] === undefined);
  if (missing.length > 0) {
    throw new TemplateError(`${source} is missing ${missing.join(', ')}.`);
  }
  return doc as T;
}

export const parseTemplate = (text: string, source: string): Template =>
  parseDoc<Template>(text, source, ['id', 'name', 'modality', 'ir']);

export const parseSnippet = (text: string, source: string): Snippet =>
  parseDoc<Snippet>(text, source, ['id', 'name', 'ir']);

export function createLibrary(templates: Template[], snippets: Snippet[]): Library {
  const t = new Map<string, Template>();
  for (const template of templates) {
    if (t.has(template.id)) throw new TemplateError(`Two templates claim the id "${template.id}".`);
    t.set(template.id, template);
  }

  const s = new Map<string, Snippet>();
  for (const snippet of snippets) {
    if (s.has(snippet.id)) throw new TemplateError(`Two snippets claim the id "${snippet.id}".`);
    s.set(snippet.id, snippet);
  }

  return { templates: t, snippets: s };
}

export function parseLibrary(templates: SourceFile[], snippets: SourceFile[]): Library {
  return createLibrary(
    templates.map((f) => parseTemplate(f.text, f.source)),
    snippets.map((f) => parseSnippet(f.text, f.source)),
  );
}

/** Templates a target can use: same modality, or no modality constraint. */
export function templatesFor(library: Library, modality: Template['modality']): Template[] {
  return [...library.templates.values()]
    .filter((t) => t.modality === modality)
    .sort((a, b) => a.name.localeCompare(b.name));
}
