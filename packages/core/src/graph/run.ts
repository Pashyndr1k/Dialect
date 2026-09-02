/**
 * Running a graph.
 *
 * Pull-based: start at the nodes nobody reads from and walk backwards, so a
 * node that nothing depends on never runs and never spends. Everything about
 * the order is derived from the edges — there is no execution list to keep in
 * step with the picture.
 *
 * The three things this file is responsible for, which no node has to think
 * about:
 *
 * - **Fan-out.** A wire carrying twenty sources runs its consumer twenty times.
 * - **Memoisation.** A node whose inputs and params are unchanged is not run
 *   again. The gateway already refuses to buy the same answer twice; this is
 *   the cheaper layer above it, and it is what makes "will this spend?"
 *   answerable before the run rather than after.
 * - **Failure that names a node.** A stack trace pointing into `compose.ts`
 *   is no use to someone looking at a canvas.
 */

import {
  CycleError,
  GraphError,
  type GraphDoc,
  type GraphNode,
  type NodeContext,
  type NodeSpec,
  type Params,
  type Signal,
  type Value,
} from './types.ts';

export interface GraphRunEvent {
  node: string;
  type: string;
  phase: 'start' | 'done' | 'cached' | 'failed';
  /** How many times the node ran, once fan-out is accounted for. */
  times?: number;
  error?: string;
}

/** A node's whole output set: one entry per output port. */
export type NodeOutputs = Record<string, Signal>;

export interface GraphRunOptions {
  /**
   * Kept between runs so editing one word re-executes only what is downstream
   * of it. Hand in the same map to get that; omit it for a cold run.
   *
   * Keyed on the node's question — its type, its params and everything that
   * arrived — and holding its whole output set, because storing ports
   * separately would be several entries that can drift apart.
   */
  memo?: Map<string, NodeOutputs>;
  onEvent?: (event: GraphRunEvent) => void;
  /** Run only what these nodes need. Defaults to every sink in the graph. */
  want?: string[];
}

export interface GraphRunResult {
  /** Every node's output ports, for the inspector to read. */
  outputs: Map<string, NodeOutputs>;
  /** Nodes that ran, in the order they ran. */
  ran: string[];
  /** Nodes skipped because their answer was already known. */
  cached: string[];
}

/**
 * A key that is the same for the same question.
 *
 * Sorted keys, because two objects that differ only in the order they were
 * built are the same question and must not be bought twice. Values on wires are
 * JSON by construction, so this is total.
 */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`).join(',')}}`;
}

/**
 * Depth-first, with the visiting set doubling as the cycle detector.
 *
 * The path is carried rather than recovered afterwards so the error can name
 * the actual circle instead of the node that happened to notice it.
 */
function order(doc: GraphDoc, want: string[]): string[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const feeders = new Map<string, Set<string>>();
  for (const e of doc.edges) {
    if (!byId.has(e.from.node)) {
      throw new GraphError(`An edge comes from "${e.from.node}", which is not in this graph.`);
    }
    if (!byId.has(e.to.node)) {
      throw new GraphError(`An edge goes to "${e.to.node}", which is not in this graph.`);
    }
    let set = feeders.get(e.to.node);
    if (!set) feeders.set(e.to.node, (set = new Set()));
    set.add(e.from.node);
  }

  const out: string[] = [];
  const done = new Set<string>();
  const path: string[] = [];
  const onPath = new Set<string>();

  const visit = (id: string): void => {
    if (done.has(id)) return;
    if (onPath.has(id)) throw new CycleError([...path.slice(path.indexOf(id)), id]);
    onPath.add(id);
    path.push(id);
    for (const feeder of feeders.get(id) ?? []) visit(feeder);
    path.pop();
    onPath.delete(id);
    done.add(id);
    out.push(id);
  };

  for (const id of want) visit(id);
  return out;
}

/** Nodes nothing reads from. What a run is for, unless told otherwise. */
export function sinksOf(doc: GraphDoc): string[] {
  const feeds = new Set(doc.edges.map((e) => e.from.node));
  return doc.nodes.filter((n) => !feeds.has(n.id)).map((n) => n.id);
}

/**
 * How many times a node runs, given what arrived on its single-valued ports.
 *
 * A wire carrying one item broadcasts: one set of words describes all twenty
 * references. Two wires carrying different counts is a question with no answer,
 * so it is refused by name rather than silently truncated to the shorter.
 */
function runCount(lengths: { port: string; n: number }[]): number {
  const many = lengths.filter((l) => l.n !== 1);
  if (many.length === 0) return 1;
  const first = many[0]!;
  for (const other of many.slice(1)) {
    if (other.n !== first.n) {
      throw new GraphError(
        `"${first.port}" has ${first.n} things on it and "${other.port}" has ${other.n}. ` +
          `Wires that fan out have to carry the same number, or one thing to share.`,
      );
    }
  }
  return first.n;
}

export async function runGraph(
  doc: GraphDoc,
  specs: Map<string, NodeSpec>,
  ctx: NodeContext,
  options: GraphRunOptions = {},
): Promise<GraphRunResult> {
  const memo = options.memo ?? new Map<string, NodeOutputs>();
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));

  // A graph with nodes but no sinks is a graph where everything feeds something
  // — which, with finitely many nodes, means a circle. Walking the sinks would
  // walk nothing and report a successful run that did nothing, so fall back to
  // every node and let the cycle detector say what is actually wrong.
  const sinks = sinksOf(doc);
  const want = options.want ?? (sinks.length > 0 ? sinks : doc.nodes.map((n) => n.id));
  const sequence = order(doc, want);

  const outputs = new Map<string, Record<string, Signal>>();
  const ran: string[] = [];
  const cached: string[] = [];

  for (const id of sequence) {
    ctx.signal?.throwIfAborted();

    const node = byId.get(id) as GraphNode;
    const spec = specs.get(node.type);
    if (!spec) {
      throw new GraphError(
        `This graph uses a node called "${node.type}", which this build does not have.`,
      );
    }

    const params: Params = { ...spec.defaults, ...node.params };

    // Gather what arrived, port by port. An unwired optional port is undefined;
    // an unwired required one is a graph that cannot run, said plainly.
    const incoming: Record<string, Signal | undefined> = {};
    for (const [port, portSpec] of Object.entries(spec.inputs)) {
      const edges = doc.edges.filter((e) => e.to.node === id && e.to.port === port);
      if (edges.length === 0) {
        if (!portSpec.optional) {
          throw new GraphError(`"${spec.title}" needs something connected to its ${port}.`);
        }
        continue;
      }
      const collected: Value[] = [];
      for (const edge of edges) {
        const source = outputs.get(edge.from.node)?.[edge.from.port];
        if (!source) {
          throw new GraphError(
            `"${spec.title}" reads ${edge.from.port} from "${edge.from.node}", which produced nothing.`,
          );
        }
        collected.push(...source);
      }
      incoming[port] = collected;
    }

    const key = `${node.type}:${stableKey({ params, incoming })}`;
    const remembered = memo.get(key);
    if (remembered) {
      outputs.set(id, remembered);
      cached.push(id);
      options.onEvent?.({ node: id, type: node.type, phase: 'cached' });
      continue;
    }

    const times = runCount(
      Object.entries(spec.inputs)
        .filter(([port, p]) => !p.whole && incoming[port])
        .map(([port]) => ({ port, n: incoming[port]!.length })),
    );

    options.onEvent?.({ node: id, type: node.type, phase: 'start', times });

    const gathered: Record<string, Value[]> = {};
    try {
      for (let i = 0; i < times; i += 1) {
        ctx.signal?.throwIfAborted();

        const slice: Record<string, Value | readonly Value[] | undefined> = {};
        for (const [port, portSpec] of Object.entries(spec.inputs)) {
          const signal = incoming[port];
          if (!signal) continue;
          slice[port] = portSpec.whole ? signal : signal[signal.length === 1 ? 0 : i];
        }

        const produced = await spec.run(slice, params, ctx);
        for (const [port, value] of Object.entries(produced)) {
          (gathered[port] ??= []).push(...(Array.isArray(value) ? value : [value as Value]));
        }
      }
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      options.onEvent?.({ node: id, type: node.type, phase: 'failed', error: why });
      throw new GraphError(`"${spec.title}" could not run: ${why}`);
    }

    outputs.set(id, gathered);
    memo.set(key, gathered);
    ran.push(id);
    options.onEvent?.({ node: id, type: node.type, phase: 'done', times });
  }

  return { outputs, ran, cached };
}
