/**
 * The graph: what the app already does, written down as nodes and wires.
 *
 * Nothing here decides anything. Every node wraps a function that already
 * exists in this package and already passes its tests, so a graph run and the
 * direct call it stands for produce the same answer or one of them is a bug.
 * That equivalence is the point — the interface changes, the compiler does not.
 *
 * Two decisions shape everything below.
 *
 * **Every wire carries a list.** Most carry one item. A node that declares an
 * input as single is run once per item on that wire, and its outputs are
 * gathered back into a list; a node that declares `whole` sees the list itself.
 * That is the whole of batch processing: a folder puts twenty sources on a
 * wire, and everything downstream runs twenty times without knowing why.
 *
 * **Reading is not done here.** Core has no filesystem and no network, and this
 * module does not change that. A source names a file; turning it into bytes is
 * the host's job, handed in as a resolver. The desktop app backs it with Tauri,
 * the tests back it with fixtures, and neither has to pretend to be the other.
 */

import type { PromptIR } from '../ir/types.ts';
import type { CompileResult } from '../compile.ts';
import type { Registry } from '../registry/types.ts';
import type { Library, Template } from '../templates/types.ts';
import type { Gateway } from '../providers/gateway.ts';
import type { ImagePart } from '../providers/types.ts';
import type { SongMeasurements } from '../extract/audio.ts';
import type { SourceKind, SourceRole } from '../compose/types.ts';

/**
 * What can travel on a wire.
 *
 * Six, and deliberately no more: the set is small enough that the editor can
 * refuse a connection that could not run, which is what stops a graph from
 * becoming a way to build broken things. They are the same six the pipeline
 * has always passed between its stages — naming them is the only new part.
 */
export const PORT_TYPES = ['words', 'source', 'lines', 'ir', 'prompt', 'template'] as const;

export type PortType = (typeof PORT_TYPES)[number];

/** Shown on a port, and in the message when a connection is refused. */
export const PORT_LABEL: Record<PortType, string> = {
  words: 'words',
  source: 'reference',
  lines: 'reading',
  ir: 'document',
  prompt: 'prompt',
  template: 'template',
};

/** A file someone attached, before anything has been read. */
export interface GraphSource {
  /** Absolute path on the host. Meaningless to core; handed back to the resolver. */
  path: string;
  /** File name, used as the bundle item's id and shown on the node. */
  name: string;
  kind: Exclude<SourceKind, 'words'>;
}

/**
 * A reading: what one source turned out to say.
 *
 * This is the thing that cost money, which is why it is a port type of its own
 * rather than an implementation detail of reading. A reading can be kept, moved
 * between graphs, and attached to fifty later prompts for nothing.
 */
export interface GraphLines {
  id: string;
  kind: SourceKind;
  lines: string[];
  /** Set by a Role node. `auto` until someone says otherwise. */
  role: SourceRole;
}

export type Value =
  | { readonly type: 'words'; readonly text: string }
  | { readonly type: 'source'; readonly source: GraphSource }
  | { readonly type: 'lines'; readonly lines: GraphLines }
  | { readonly type: 'ir'; readonly ir: PromptIR }
  | { readonly type: 'prompt'; readonly prompt: CompileResult }
  | { readonly type: 'template'; readonly template: Template };

/** Every wire carries a list. Most carry one item. */
export type Signal = readonly Value[];

export interface PortSpec {
  type: PortType;
  /**
   * Take the whole list at once instead of one item per run. True for the
   * inputs that exist to combine things — Compose takes every reading it is
   * given, which is the only way a bundle can have more than one source in it.
   */
  whole?: boolean;
  /** A missing wire is allowed. The node sees `undefined`. */
  optional?: boolean;
  label?: string;
}

/**
 * What a node holds that is not wired: an axis, a count, a target id, a role.
 *
 * Params are plain JSON so a graph is a file a person can read and fix by hand,
 * the same as the templates and the model cards.
 */
export type Params = Record<string, unknown>;

export interface NodeContext {
  gateway: Gateway;
  registry: Registry;
  library?: Library;
  /**
   * Turns a source into the pictures a reader looks at. Frames for a clip,
   * spectrograms for a track, the image itself for a still.
   *
   * Supplied by the host because core cannot open a file. A node asks for what
   * it needs and does not learn where it came from.
   */
  resolve: SourceResolver;
  signal?: AbortSignal;
}

/**
 * What the host found in a file: pictures to look at, and the facts it measured
 * rather than guessed.
 *
 * The facts matter as much as the pictures. A clip's duration and aspect come
 * from a probe, and a track's tempo, key and loudness are counted — the reader
 * is told them so it does not have to estimate from a spectrogram.
 */
export interface ResolvedSource {
  parts: ImagePart[];
  /** Video: what the probe found. */
  durationS?: number;
  aspectRatio?: string;
  /** Audio: everything measured. The reference name is filled in by the node. */
  measurements?: Omit<SongMeasurements, 'reference'>;
}

export type SourceResolver = (source: GraphSource) => Promise<ResolvedSource>;

/**
 * A node type: its ports, its cost, and what it does.
 *
 * `run` sees inputs already unwrapped — a single-valued port arrives as one
 * `Value`, a `whole` port as the list — and returns the same shape. The runner
 * does the mapping, the gathering and the caching, so a node body is only ever
 * the call it stands for.
 */
export interface NodeSpec {
  type: string;
  title: string;
  /** Groups the node in the editor's menu. */
  group: 'in' | 'read' | 'compose' | 'shape' | 'out';
  /**
   * One line, for the menu you pick this from.
   *
   * What it is for, not what it is called again. A catalogue of sixteen names
   * with no other words on it makes you open each one to find out which is
   * which, and that is not a catalogue, it is a list of guesses.
   */
  hint: string;
  inputs: Record<string, PortSpec>;
  outputs: Record<string, PortSpec>;
  /**
   * This node can spend money. Drives the estimate shown before a run, and it
   * is a property of the node rather than of the call, because a cached call
   * spends nothing and the estimate has to say so.
   */
  spends?: boolean;
  defaults?: Params;
  run(
    inputs: Record<string, Value | readonly Value[] | undefined>,
    params: Params,
    ctx: NodeContext,
  ): Promise<Record<string, Value | readonly Value[]>>;
}

/** A node as it appears in a saved graph. */
export interface GraphNode {
  id: string;
  type: string;
  params?: Params;
  /** Editor only; the runner never reads it. */
  at?: { x: number; y: number };
}

export interface GraphEdge {
  from: { node: string; port: string };
  to: { node: string; port: string };
}

/**
 * A graph, as it is saved.
 *
 * Versioned from the first one, because a graph is a file people keep and the
 * alternative is guessing later what an old one meant.
 */
export interface GraphDoc {
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
  name?: string;
}

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

/**
 * A connection that could not carry anything.
 *
 * Says both types by name, because "type mismatch" tells someone holding a
 * mouse nothing about which end to move.
 */
export class BadConnectionError extends GraphError {
  constructor(from: PortType, to: PortType) {
    super(
      `A ${PORT_LABEL[from]} cannot go into a ${PORT_LABEL[to]}. ` +
        `Read the reference first if you need a ${PORT_LABEL.lines}.`,
    );
    this.name = 'BadConnectionError';
  }
}

export class CycleError extends GraphError {
  constructor(ids: string[]) {
    super(`These nodes feed each other in a circle: ${ids.join(' → ')}.`);
    this.name = 'CycleError';
  }
}
