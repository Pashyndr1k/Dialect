/**
 * What each node shows on its face.
 *
 * Kept out of core on purpose. A node's ports and what it does are the
 * compiler's business; whether the target is a dropdown and where its options
 * come from is the window's, and the options here are read from the live
 * registry and library rather than written down.
 *
 * Fat for inputs and settings, thin for anything producing text: a set of words
 * is worth seeing on the canvas, a rendered prompt is not — it goes to the
 * inspector, because several hundred words do not shrink.
 */

import {
  AXIS_LABEL,
  ROLE_LABEL,
  SOURCE_ROLES,
  TEMPLATE_KINDS,
  VARY_AXES,
  type LoadedRegistry,
  type Library,
} from '@dialect/core';

import type { SavedSource } from '@dialect/core';

import { sortProfiles } from '../registry.ts';

export interface Choice {
  value: string;
  label: string;
  /** Groups the list, e.g. image / video / audio. */
  group?: string;
}

export type Control =
  | { kind: 'text'; key: string; label: string; rows?: number; placeholder?: string }
  | {
      kind: 'select';
      key: string;
      label: string;
      options: (w: World) => Choice[];
      /**
       * What choosing this option actually sets.
       *
       * Most selects set one param. Picking a kept reading sets three — what it
       * is called, what kind it is, and the lines it cost money to get — so the
       * choice carries the whole thing rather than an id to look up later.
       */
      apply?: (value: string, w: World) => Record<string, unknown>;
    }
  | { kind: 'number'; key: string; label: string; min: number; max: number }
  | { kind: 'file'; key: string; label: string }
  | { kind: 'folder'; key: string; label: string };

/** What the option lists are read from, so nothing here is a hardcoded list. */
export interface World {
  registry: LoadedRegistry;
  library: Library;
  /** Readings someone kept. Empty until the host has been asked. */
  sources: SavedSource[];
}

const roleChoices = (): Choice[] =>
  SOURCE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

const CONTROLS: Record<string, Control[]> = {
  words: [{ kind: 'text', key: 'text', label: 'Words', rows: 4, placeholder: 'What do you want?' }],

  reference: [{ kind: 'file', key: 'path', label: 'File' }],

  document: [
    {
      kind: 'text',
      key: 'json',
      label: 'Document',
      rows: 6,
      placeholder: 'Paste a document, or wire one in from elsewhere.',
    },
  ],

  folder: [{ kind: 'folder', key: 'dir', label: 'Folder' }],

  read: [{ kind: 'select', key: 'role', label: 'Job', options: roleChoices }],

  role: [{ kind: 'select', key: 'role', label: 'Job', options: roleChoices }],

  kept: [
    {
      kind: 'select',
      key: 'id',
      label: 'Kept',
      options: ({ sources }) =>
        sources.map((s) => ({ value: s.id, label: s.name, group: s.kind })),
      apply: (value, { sources }) => {
        const found = sources.find((s) => s.id === value);
        if (!found) return { id: value };
        // The lines come with it. A kept reading was paid for once and is text
        // afterwards, so attaching it costs nothing and needs no lookup later.
        return { id: found.id, kind: found.kind, role: found.role, lines: found.lines };
      },
    },
  ],

  template: [
    {
      kind: 'select',
      key: 'id',
      label: 'Template',
      options: ({ library }) =>
        [...library.templates.values()].map((t) => ({
          value: t.id,
          label: t.name,
          group: t.modality,
        })),
    },
  ],

  compose: [
    {
      kind: 'select',
      key: 'modality',
      label: 'Making',
      options: () => [
        { value: 'image', label: 'an image' },
        { value: 'video', label: 'a shot' },
        { value: 'audio', label: 'a piece' },
      ],
    },
  ],

  idea: [
    {
      kind: 'select',
      key: 'modality',
      label: 'Making',
      options: () => [
        { value: 'image', label: 'an image' },
        { value: 'video', label: 'a shot' },
        { value: 'audio', label: 'a piece' },
      ],
    },
  ],

  vary: [
    {
      kind: 'select',
      key: 'axis',
      label: 'Along',
      options: () => VARY_AXES.map((a) => ({ value: a, label: AXIS_LABEL[a] })),
    },
    { kind: 'number', key: 'count', label: 'How many', min: 2, max: 12 },
  ],

  learn: [
    {
      kind: 'select',
      key: 'kind',
      label: 'Shape',
      options: () => TEMPLATE_KINDS.map((k) => ({ value: k, label: k })),
    },
    { kind: 'number', key: 'cast', label: 'People', min: 0, max: 2 },
  ],

  compile: [
    {
      kind: 'select',
      key: 'target',
      label: 'Model',
      options: ({ registry }) =>
        sortProfiles(registry).map((p) => ({
          value: p.id,
          label: p.label,
          group: p.family,
        })),
    },
  ],
};

export const controlsFor = (type: string): Control[] => CONTROLS[type] ?? [];

/**
 * A short line under the title saying what this node is set to.
 *
 * The canvas is read at a distance and a node whose face says only "Compile"
 * makes you click it to find out which model. This is what a fat node buys.
 */
export function summaryOf(type: string, params: Record<string, unknown>, w: World): string {
  const s = (key: string): string => (typeof params[key] === 'string' ? (params[key] as string) : '');

  switch (type) {
    case 'words': {
      const text = s('text').trim();
      return text ? (text.length > 60 ? `${text.slice(0, 57)}…` : text) : 'nothing typed yet';
    }
    case 'reference':
      return s('name') || s('path').split(/[\\/]/).pop() || 'no file chosen';
    case 'folder':
      return s('dir').split(/[\\/]/).pop() || 'no folder chosen';
    case 'document': {
      const text = s('json').trim();
      if (!text) return params.ir ? 'a document' : 'empty';
      try {
        return (JSON.parse(text) as { title?: string }).title || 'a document';
      } catch {
        // Said here rather than only at run time: a document that will not
        // parse is worth knowing about before pressing anything.
        return 'will not parse';
      }
    }
    case 'read':
    case 'role': {
      const role = s('role') || 'auto';
      return role === 'auto' ? 'job worked out from the rest' : `as ${ROLE_LABEL[role as never]}`;
    }
    case 'compile': {
      const id = s('target');
      if (!id) return 'no model chosen';
      return w.registry.registry.profiles.get(id)?.label ?? id;
    }
    case 'kept': {
      const lines = Array.isArray(params.lines) ? (params.lines as string[]) : [];
      if (lines.length === 0) return 'nothing chosen';
      return w.sources.find((x) => x.id === s('id'))?.name ?? `${lines.length} lines`;
    }
    case 'template': {
      const id = s('id');
      return w.library.templates.get(id)?.name ?? (id || 'no template chosen');
    }
    case 'vary': {
      const n = typeof params.count === 'number' ? params.count : 4;
      return `${n} along ${AXIS_LABEL[(s('axis') || 'subject') as never]}`;
    }
    case 'compose':
      return s('templateId') ? `into ${s('templateId')}` : 'everything, with its jobs';
    default:
      return '';
  }
}
