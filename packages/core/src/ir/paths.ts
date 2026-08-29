/**
 * Addressing IR fields by path.
 *
 * Segments carry the paths they were built from, so the editor can open the
 * fields behind a chip instead of asking anyone to edit the prompt as text.
 * Paths are plain dotted keys — `lighting.key`, `subject.entities[0].description`.
 */

import type { PromptIR } from './types.ts';

export type LeafKind = 'string' | 'string[]' | 'number' | 'boolean';

export interface Leaf {
  path: string;
  /** Last segment of the path, for a label. */
  key: string;
  kind: LeafKind;
  value: string | string[] | number | boolean;
}

type Bag = Record<string, unknown>;

function parse(path: string): Array<string | number> {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((p) => p.length > 0)
    .map((p) => (/^\d+$/.test(p) ? Number.parseInt(p, 10) : p));
}

export function getPath(ir: PromptIR, path: string): unknown {
  let cursor: unknown = ir;
  for (const step of parse(path)) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Bag)[String(step)];
  }
  return cursor;
}

/**
 * Returns a copy with `path` set. Never mutates: the editor keeps the previous
 * document so undo stays possible, and React needs a new reference anyway.
 *
 * Setting `undefined` or an empty string removes the field rather than leaving
 * an empty one behind — an empty string in the IR renders as an empty clause.
 */
export function setPath(ir: PromptIR, path: string, value: unknown): PromptIR {
  const steps = parse(path);
  if (steps.length === 0) return ir;

  const root = structuredClone(ir) as unknown as Bag;
  let cursor: Bag = root;

  for (const step of steps.slice(0, -1)) {
    const key = String(step);
    const next = cursor[key];
    if (next === null || next === undefined || typeof next !== 'object') {
      cursor[key] = typeof step === 'number' ? [] : {};
    }
    cursor = cursor[key] as Bag;
  }

  const last = String(steps[steps.length - 1]);
  const empty =
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0);

  if (empty) delete cursor[last];
  else cursor[last] = value;

  return root as unknown as PromptIR;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * The editable fields at or below `path`.
 *
 * Recurses into plain objects and into arrays of objects, so `subject` yields
 * each entity's own fields. Arrays of strings stop here and are edited as one
 * comma-separated field, which is how they read in a prompt anyway.
 */
export function leavesUnder(ir: PromptIR, path: string, depth = 4): Leaf[] {
  const value = getPath(ir, path);
  if (value === undefined || value === null) return [];

  const key = path.slice(path.lastIndexOf('.') + 1);

  if (typeof value === 'string') return [{ path, key, kind: 'string', value }];
  if (typeof value === 'number') return [{ path, key, kind: 'number', value }];
  if (typeof value === 'boolean') return [{ path, key, kind: 'boolean', value }];
  if (isStringArray(value)) return [{ path, key, kind: 'string[]', value }];

  if (depth <= 0) return [];

  if (Array.isArray(value)) {
    return value.flatMap((_, i) => leavesUnder(ir, `${path}[${i}]`, depth - 1));
  }
  if (typeof value === 'object') {
    return Object.keys(value as Bag).flatMap((k) => leavesUnder(ir, `${path}.${k}`, depth - 1));
  }
  return [];
}

/**
 * The fields behind a segment, in the order its renderer named them.
 *
 * A path that addresses nothing yet still appears, so the editor can offer an
 * empty field rather than hiding a slot the dialect knows about. Paths ending
 * in `[]` are wildcards a renderer used to mean "each of these" — the concrete
 * indices are found by walking the array instead.
 */
export function fieldsForSegment(ir: PromptIR, from: readonly string[]): Leaf[] {
  const seen = new Set<string>();
  const out: Leaf[] = [];

  for (const raw of from) {
    for (const path of expandWildcards(ir, raw)) {
      for (const leaf of leavesUnder(ir, path)) {
        if (seen.has(leaf.path)) continue;
        seen.add(leaf.path);
        out.push(leaf);
      }
    }
  }
  return out;
}

/** `subject.entities[].name` becomes one path per entity that exists. */
function expandWildcards(ir: PromptIR, path: string): string[] {
  const at = path.indexOf('[]');
  if (at === -1) return [path];

  const prefix = path.slice(0, at);
  const rest = path.slice(at + 2);
  const array = getPath(ir, prefix);
  if (!Array.isArray(array)) return [];

  return array.flatMap((_, i) => expandWildcards(ir, `${prefix}[${i}]${rest}`));
}

/** Which reference, if any, supplied a field. Drives the source map. */
export function provenanceFor(ir: PromptIR, path: string): string | undefined {
  const root = path.split(/[.[]/)[0] ?? path;
  return ir.provenance?.find((p) => p.fields.includes(root) || p.fields.includes(path))?.ref;
}
