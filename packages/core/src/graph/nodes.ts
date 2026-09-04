/**
 * The node catalogue.
 *
 * Every entry is a wrapper. The call inside each `run` is the same call the app
 * makes today, with the same arguments, and none of them decides anything new —
 * if a node body starts to contain logic, that logic belongs in the module it
 * is wrapping, where the tests are.
 *
 * Two nodes are missing on purpose and are supplied by the host: **Folder**,
 * which has to scan a directory, and **Save**, which has to write files. Core
 * has no filesystem and this module does not become the exception to that.
 */

import { compile } from '../compile.ts';
import { composeBundle } from '../compose/compose.ts';
import { sceneLines, shotLines, songLines } from '../compose/lines.ts';
import { expandIdea, fillTemplate } from '../extract/idea.ts';
import { extractFromAudio } from '../extract/audio.ts';
import { extractFromImages } from '../extract/image.ts';
import { extractFromVideo } from '../extract/video.ts';
import { setPath } from '../ir/paths.ts';
import { getProfile } from '../registry/load.ts';
import { expandShot } from '../sequence/expand.ts';
import { SEQUENCE_VERSION, type Sequence, type SequenceShot } from '../sequence/types.ts';
import { learnTemplate, type CastSize, type TemplateKind } from '../templates/learn.ts';
import { applyVariant, vary } from '../vary/vary.ts';
import { SOURCE_ROLES, type Bundle, type SourceRole } from '../compose/types.ts';
import type { PromptIR } from '../ir/types.ts';
import type { DeckEntry, VaryAxis } from '../vary/types.ts';
import {
  GraphError,
  type GraphLines,
  type GraphSource,
  type NodeSpec,
  type Value,
} from './types.ts';

/*
 * Unwrapping.
 *
 * The runner guarantees a port holds what the spec said it holds, so these
 * throw only when the catalogue itself is wrong. They exist so a genuine bug
 * says which port on which node, rather than surfacing as `undefined` three
 * calls later.
 */

const one = <T extends Value['type']>(
  value: Value | readonly Value[] | undefined,
  type: T,
  port: string,
): Extract<Value, { type: T }> => {
  const v = Array.isArray(value) ? value[0] : (value as Value | undefined);
  if (!v || v.type !== type) {
    throw new GraphError(`The ${port} port expected a ${type} and got ${v?.type ?? 'nothing'}.`);
  }
  return v as Extract<Value, { type: T }>;
};

const many = <T extends Value['type']>(
  value: Value | readonly Value[] | undefined,
  type: T,
  port: string,
): Extract<Value, { type: T }>[] => {
  const list = Array.isArray(value) ? value : value ? [value as Value] : [];
  for (const v of list) {
    if (v.type !== type) {
      throw new GraphError(`The ${port} port expected ${type} and found a ${v.type}.`);
    }
  }
  return list as Extract<Value, { type: T }>[];
};

const str = (params: Record<string, unknown>, key: string, fallback = ''): string =>
  typeof params[key] === 'string' ? (params[key] as string) : fallback;

/** How many of each a Reference node will hold. */
export const REFERENCE_MAX = 3;

const list = (params: Record<string, unknown>, key: string): Record<string, unknown>[] =>
  Array.isArray(params[key])
    ? (params[key] as unknown[]).filter(
        (v): v is Record<string, unknown> => typeof v === 'object' && v !== null,
      )
    : [];

/**
 * The files on a Reference node.
 *
 * Also reads the single `path`/`name`/`kind` a Reference held before it could
 * hold three, so a graph saved by an older build opens with its file still on
 * it rather than empty. Both shapes, never the two at once: the list wins where
 * there is one, because that is what the current editor writes.
 */
export function filesOf(params: Record<string, unknown>): GraphSource[] {
  const rows = list(params, 'files');
  const from = (p: Record<string, unknown>): GraphSource | undefined => {
    const path = str(p, 'path');
    if (!path) return undefined;
    return {
      path,
      name: str(p, 'name', path.split(/[\\/]/).pop() ?? path),
      kind: (str(p, 'kind', 'image') as GraphSource['kind']) ?? 'image',
    };
  };

  if (rows.length > 0) return rows.flatMap((p) => from(p) ?? []);
  const only = from(params);
  return only ? [only] : [];
}

/** The readings picked out of Memory on a Reference node. */
export function readingsOf(params: Record<string, unknown>): GraphLines[] {
  return list(params, 'readings').flatMap((p) => {
    const lines = Array.isArray(p.lines) ? (p.lines as string[]) : [];
    if (lines.length === 0) return [];
    return [
      {
        id: str(p, 'id', 'kept'),
        kind: (str(p, 'kind', 'image') as GraphLines['kind']) ?? 'image',
        role: (str(p, 'role', 'auto') as SourceRole) ?? 'auto',
        lines,
      },
    ];
  });
}

const specs: NodeSpec[] = [
  /* ---------------------------------------------------------------- in --- */

  {
    type: 'words',
    title: 'User prompt',
    group: 'in',
    hint: 'What you type yourself. The starting point when you have no reference.',
    inputs: {},
    outputs: { out: { type: 'words' } },
    defaults: { text: '' },
    async run(_inputs, params) {
      const text = str(params, 'text').trim();
      if (!text) throw new GraphError('Say at least one word about what you want.');
      return { out: { type: 'words', text } };
    },
  },

  {
    /**
     * The references a graph works from, and the readings of them you already
     * have.
     *
     * One node rather than two. "Reference" and "Reading from Memory" were the
     * same thing at two moments in its life: a file you have not paid to look
     * at yet, and a file you paid to look at last week. Two nodes meant that
     * using the reading you already had was a different box, wired into a
     * different port, rather than a choice about the same reference.
     *
     * So the readings win. Pick one or more from Memory and the files are not
     * emitted at all — they stay listed, shown deactivated, because the point
     * is to switch back and forth without losing the paths. Reading a file
     * costs money; reading it twice costs money twice.
     */
    type: 'reference',
    title: 'Reference',
    group: 'in',
    hint: 'Up to three files from disk, or readings of them already in Memory.',
    inputs: {},
    outputs: {
      out: { type: 'source' },
      read: { type: 'lines', label: 'from Memory' },
    },
    async run(_inputs, params): Promise<Record<string, Value | readonly Value[]>> {
      const readings = readingsOf(params);
      if (readings.length > 0) {
        return { read: readings.map((lines) => ({ type: 'lines' as const, lines })) };
      }

      const files = filesOf(params);
      if (files.length === 0) {
        throw new GraphError('Choose a file for this reference, or a reading from Memory.');
      }
      return { out: files.map((source) => ({ type: 'source' as const, source })) };
    },
  },

  {
    /**
     * Folded into `reference`, and kept only so graphs that hold one still run.
     * See `NodeSpec.hidden`.
     */
    type: 'kept',
    title: 'Reading from Memory',
    group: 'in',
    hidden: true,
    hint: 'A reading kept earlier. Now part of the Reference node.',
    inputs: {},
    outputs: { out: { type: 'lines' } },
    async run(_inputs, params) {
      const lines = Array.isArray(params.lines) ? (params.lines as string[]) : [];
      if (lines.length === 0) throw new GraphError('This kept reading has nothing in it.');
      return {
        out: {
          type: 'lines',
          lines: {
            id: str(params, 'id', 'kept'),
            kind: (str(params, 'kind', 'image') as GraphLines['kind']) ?? 'image',
            role: (str(params, 'role', 'auto') as SourceRole) ?? 'auto',
            lines,
          },
        },
      };
    },
  },

  {
    // A document that is already written: a restored session, a fixture, or
    // something someone kept. The way an IR enters a graph without being paid
    // for again.
    type: 'document',
    title: 'Document',
    group: 'in',
    hint: 'A description you already have, pasted in or wired from elsewhere.',
    inputs: {},
    outputs: { out: { type: 'ir' } },
    async run(_inputs, params) {
      // Either a document already parsed, or the text of one. The text form is
      // what someone pastes in, and it is the same thing they would paste into
      // the field editor, so a bad one has to say where it went wrong rather
      // than just refusing.
      if (typeof params.json === 'string' && params.json.trim()) {
        try {
          const parsed: unknown = JSON.parse(params.json);
          if (!parsed || typeof parsed !== 'object') {
            throw new GraphError('That document is not an object.');
          }
          return { out: { type: 'ir', ir: parsed as PromptIR } };
        } catch (error) {
          if (error instanceof GraphError) throw error;
          throw new GraphError(`That document will not parse: ${(error as Error).message}`);
        }
      }

      const ir = params.ir as PromptIR | undefined;
      if (!ir || typeof ir !== 'object') throw new GraphError('This document node is empty.');
      return { out: { type: 'ir', ir } };
    },
  },

  {
    type: 'template',
    title: 'Template',
    group: 'in',
    hint: 'One of your saved templates, ready to be filled in.',
    inputs: {},
    outputs: { out: { type: 'template' } },
    async run(_inputs, params, ctx) {
      const id = str(params, 'id');
      const found = ctx.library?.templates.get(id);
      if (!found) {
        throw new GraphError(
          `No template called "${id}". Known: ` +
            `${[...(ctx.library?.templates.keys() ?? [])].join(', ') || '(none)'}.`,
        );
      }
      return { out: { type: 'template', template: found } };
    },
  },

  /* -------------------------------------------------------------- read --- */

  {
    // One node for all three kinds. An image, a video and audio are read
    // differently, but from the graph's side they answer the same question, and
    // three nodes would mean three wires to rearrange when a file kind changes.
    type: 'read',
    title: 'Read',
    group: 'read',
    hint: 'Looks at a reference and says what is in it. The step that costs.',
    inputs: { source: { type: 'source' } },
    outputs: {
      out: { type: 'lines' },
      // A reading already contains a document — the readers return one and it
      // costs nothing extra. Handing it back is what lets a single reference
      // reach a prompt without paying to compose a bundle of one, which is the
      // path the app has always taken.
      ir: { type: 'ir', label: 'document' },
    },
    spends: true,
    defaults: { role: 'auto' },
    async run(inputs, params, ctx) {
      const { source } = one(inputs.source, 'source', 'source');
      const resolved = await ctx.resolve(source);
      const role = (str(params, 'role', 'auto') as SourceRole) ?? 'auto';
      const reference = source.name;

      const read = await (async (): Promise<{ lines: string[]; ir: PromptIR }> => {
        if (source.kind === 'image') {
          const r = await extractFromImages(ctx.gateway, resolved.parts, { reference });
          return { lines: sceneLines(r.scene), ir: r.ir };
        }
        if (source.kind === 'video') {
          const r = await extractFromVideo(ctx.gateway, resolved.parts, {
            reference,
            ...(resolved.durationS === undefined ? {} : { durationS: resolved.durationS }),
            ...(resolved.aspectRatio === undefined ? {} : { aspectRatio: resolved.aspectRatio }),
          });
          return { lines: shotLines(r.shot), ir: r.ir };
        }
        if (!resolved.measurements) {
          throw new GraphError(`"${reference}" was not measured, so it cannot be described.`);
        }
        const r = await extractFromAudio(ctx.gateway, resolved.parts, {
          ...resolved.measurements,
          reference,
        });
        return { lines: songLines(r.song), ir: r.ir };
      })();

      return {
        out: { type: 'lines', lines: { id: reference, kind: source.kind, role, lines: read.lines } },
        ir: { type: 'ir', ir: read.ir },
      };
    },
  },

  {
    // Roles are the whole reason a bundle works, so changing one is a node you
    // can see rather than a dropdown hidden on the thing that produced it.
    type: 'role',
    title: 'Role',
    group: 'read',
    hint: 'Says what a reading is for — the subject, or only the look.',
    inputs: { lines: { type: 'lines' } },
    outputs: { out: { type: 'lines' } },
    defaults: { role: 'subject' },
    async run(inputs, params) {
      const { lines } = one(inputs.lines, 'lines', 'lines');
      const role = str(params, 'role', 'auto') as SourceRole;
      if (!SOURCE_ROLES.includes(role)) {
        throw new GraphError(`"${role}" is not a job. Try: ${SOURCE_ROLES.join(', ')}.`);
      }
      return { out: { type: 'lines', lines: { ...lines, role } } };
    },
  },

  /* ----------------------------------------------------------- compose --- */

  {
    type: 'compose',
    title: 'Compose',
    group: 'compose',
    hint: 'Puts words and readings together into one description.',
    inputs: {
      // Whole, because combining is the entire job: a bundle with one source in
      // it is a bundle that did not need composing.
      lines: { type: 'lines', whole: true },
      words: { type: 'words', optional: true },
    },
    outputs: { out: { type: 'ir' } },
    spends: true,
    defaults: { modality: 'image' },
    async run(inputs, params, ctx) {
      const readings = many(inputs.lines, 'lines', 'lines');
      const words = inputs.words ? one(inputs.words, 'words', 'words') : undefined;
      const templateId = str(params, 'templateId');

      const bundle: Bundle = {
        modality: str(params, 'modality', 'image') as Bundle['modality'],
        items: [
          ...(words ? [{ id: 'words', kind: 'words' as const, role: 'auto' as const, lines: [words.text] }] : []),
          ...readings.map((r) => ({
            id: r.lines.id,
            kind: r.lines.kind,
            role: r.lines.role,
            lines: r.lines.lines,
          })),
        ],
      };

      // With a template, the composer is asked only the template's own
      // questions and never sees its document — so what the template already
      // decided stays decided. That is a different call from filling a template
      // from words alone, which is why both exist.
      if (templateId && !ctx.library) {
        throw new GraphError(`Compose was given the template "${templateId}" and no library.`);
      }
      const result = await composeBundle(ctx.gateway, bundle, {
        ...(templateId && ctx.library ? { templateId, library: ctx.library } : {}),
      });
      return { out: { type: 'ir', ir: result.ir } };
    },
  },

  {
    type: 'idea',
    title: 'Idea',
    group: 'compose',
    hint: 'Grows a sentence into a full description on its own.',
    inputs: { words: { type: 'words' } },
    outputs: { out: { type: 'ir' } },
    spends: true,
    defaults: { modality: 'image' },
    async run(inputs, params, ctx) {
      const { text } = one(inputs.words, 'words', 'words');
      const result = await expandIdea(ctx.gateway, text, {
        modality: str(params, 'modality', 'image') as Bundle['modality'],
      });
      return { out: { type: 'ir', ir: result.ir } };
    },
  },

  {
    type: 'fill',
    title: 'Fill template',
    group: 'compose',
    hint: 'Fills a template from a few words.',
    inputs: {
      words: { type: 'words' },
      template: { type: 'template' },
    },
    outputs: { out: { type: 'ir' } },
    spends: true,
    async run(inputs, _params, ctx) {
      const { text } = one(inputs.words, 'words', 'words');
      const { template } = one(inputs.template, 'template', 'template');
      if (!ctx.library) throw new GraphError('No template library is loaded.');
      const result = await fillTemplate(ctx.gateway, text, ctx.library, template.id);
      return { out: { type: 'ir', ir: result.ir } };
    },
  },

  /* ------------------------------------------------------------- shape --- */

  {
    type: 'fields',
    title: 'Edit fields',
    group: 'shape',
    hint: 'Change the description by hand: light, era, framing, faces.',
    inputs: { ir: { type: 'ir' } },
    outputs: { out: { type: 'ir' } },
    defaults: { set: {} },
    async run(inputs, params) {
      const { ir } = one(inputs.ir, 'ir', 'ir');
      const edits = (params.set ?? {}) as Record<string, unknown>;
      let next = ir;
      for (const [path, value] of Object.entries(edits)) next = setPath(next, path, value);
      return { out: { type: 'ir', ir: next } };
    },
  },

  {
    // One call for many variants, never many calls for one each: separate calls
    // produce similar answers, which is the opposite of the point.
    type: 'vary',
    title: 'Vary',
    group: 'shape',
    hint: 'Many versions along one axis, from a single request.',
    inputs: { ir: { type: 'ir' } },
    outputs: { out: { type: 'ir' } },
    spends: true,
    defaults: { axis: 'subject', count: 4 },
    async run(inputs, params, ctx) {
      const { ir } = one(inputs.ir, 'ir', 'ir');
      const axis = str(params, 'axis', 'subject') as VaryAxis;
      const count = typeof params.count === 'number' ? params.count : 4;
      const brief = str(params, 'brief').trim();

      // A card drawn from a deck, carried on the node rather than redrawn each
      // run: a variation set that changed every time it was asked for would not
      // be a set anyone could go back to.
      const nudge = params.nudge as DeckEntry | undefined;

      const result = await vary(ctx.gateway, ir, {
        axis,
        count,
        ...(brief ? { brief } : {}),
        ...(nudge && typeof nudge === 'object' && nudge.id ? { nudge } : {}),
      });
      return {
        out: result.variants.map((v) => ({
          type: 'ir' as const,
          ir: applyVariant(ir, axis, v),
        })),
      };
    },
  },

  {
    type: 'sequence',
    title: 'Sequence',
    group: 'shape',
    hint: 'Several shots that inherit one world, so nothing drifts.',
    inputs: { ir: { type: 'ir' } },
    outputs: { out: { type: 'ir' } },
    defaults: { shots: [] },
    async run(inputs, params) {
      const { ir } = one(inputs.ir, 'ir', 'ir');
      const shots = Array.isArray(params.shots) ? params.shots : [];
      if (shots.length === 0) throw new GraphError('This sequence has no shots in it yet.');

      // The world is stated once so it cannot drift between shots; each shot is
      // only what it changes.
      const sequence: Sequence = {
        seqVersion: SEQUENCE_VERSION,
        world: ir,
        shots: shots as SequenceShot[],
      };
      return {
        out: shots.map((_, i) => ({ type: 'ir' as const, ir: expandShot(sequence, i) })),
      };
    },
  },

  {
    type: 'learn',
    title: 'Learn template',
    group: 'shape',
    hint: 'Takes a prompt that works and turns it into a template.',
    inputs: { words: { type: 'words' } },
    outputs: { out: { type: 'template' } },
    spends: true,
    defaults: { kind: 'text2img', cast: 1 },
    async run(inputs, params, ctx) {
      const { text } = one(inputs.words, 'words', 'words');
      const writtenFor = str(params, 'writtenFor');
      const learned = await learnTemplate(ctx.gateway, text, {
        kind: str(params, 'kind', 'text2img') as TemplateKind,
        cast: (typeof params.cast === 'number' ? params.cast : 1) as CastSize,
        // Passed only when set: the target a template was written for is part
        // of what it is, and an empty string is not a target.
        ...(writtenFor ? { writtenFor } : {}),
      });
      return { out: { type: 'template', template: learned.template } };
    },
  },

  /* --------------------------------------------------------------- out --- */

  {
    type: 'compile',
    title: 'Compile',
    group: 'out',
    hint: 'Writes the description out in one model’s own dialect. Free.',
    inputs: { ir: { type: 'ir' } },
    outputs: { out: { type: 'prompt' } },
    defaults: { target: '' },
    async run(inputs, params, ctx) {
      const { ir } = one(inputs.ir, 'ir', 'ir');
      const target = str(params, 'target');
      if (!target) throw new GraphError('Choose a model for this Compile node.');

      const profile = getProfile(ctx.registry, target);
      const disabled = Array.isArray(params.disabledRules)
        ? (params.disabledRules as string[])
        : [];

      // Never throws on a block here: a blocked prompt is a result the canvas
      // should show with its findings, not an exception that loses the run.
      const result = compile(ir, profile, { disabledRules: disabled, throwOnBlock: false });
      return { out: { type: 'prompt', prompt: result } };
    },
  },
];

/** The nodes this build knows, by type. Hosts add their own before running. */
export const BUILTIN_NODES: Map<string, NodeSpec> = new Map(specs.map((s) => [s.type, s]));

export const builtinNodeList = (): readonly NodeSpec[] => specs;
