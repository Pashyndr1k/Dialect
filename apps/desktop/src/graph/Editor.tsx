/**
 * The canvas.
 *
 * The graph is the document and React Flow is a view of it — positions are
 * written back, everything else flows one way. That matters because the graph
 * is also what gets saved, run and sent to someone, so there is no second copy
 * to fall out of step.
 *
 * Three things sit around the canvas because a node cannot hold them: the run
 * bar, which owns the money; the inspector, which holds the text a two-inch box
 * cannot show; and the add menu, which is where a node comes from.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  canConnect,
  checkGraph,
  refusalFor,
  runGraph,
  sinksOf,
  spendingNodes,
  type GraphDoc,
  type GraphRunEvent,
  type Library,
  type LoadedRegistry,
  type NodeOutputs,
  type NodeSpec,
} from '@dialect/core';

import { NODES, resolveSource } from './host.ts';
import { EXAMPLES } from './examples.ts';
import { NodeBody } from './Node.tsx';
import { BoardProvider, type NodeFace, type NodeState } from './NodeData.tsx';
import { Inspector } from './Inspector.tsx';
import { gateway, BUDGET_USD, onSpend } from '../gateway.ts';
import { pickFolder, pickReferences } from '../store.ts';
import { idFor, listGraphs, openGraphsFolder, saveGraph, type SavedGraph } from '../graphs.ts';
import { listSources } from '../sources.ts';
import { OPEN_ID, rememberOpenGraph } from './open.ts';
import type { SavedSource } from '@dialect/core';
import { kindOf } from '@dialect/core';

const nodeTypes = { dialect: NodeBody };

/** A new id that reads as what it is, so a saved graph can be followed by eye. */
const freshId = (type: string, taken: Set<string>): string => {
  for (let n = 1; ; n += 1) {
    const id = `${type}-${n}`;
    if (!taken.has(id)) return id;
  }
};

const EMPTY: GraphDoc = { version: 1, nodes: [], edges: [] };

export interface EditorProps {
  registry: LoadedRegistry;
  library: Library;
  doc?: GraphDoc;
  onDocChange?: (doc: GraphDoc) => void;
}

interface NodeRun {
  state: NodeState;
  note?: string;
  error?: string;
  /** What this node cost this run. Zero when the answer was already known. */
  usd?: number;
}

function Board({ registry, library, doc: initial, onDocChange }: EditorProps): React.ReactElement {
  const [doc, setDoc] = useState<GraphDoc>(initial ?? EMPTY);
  const [runs, setRuns] = useState<Record<string, NodeRun>>({});
  const [outputs, setOutputs] = useState<Map<string, NodeOutputs>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [spent, setSpent] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [opening, setOpening] = useState(false);
  const [saved, setSaved] = useState<SavedGraph[]>([]);

  // Kept across runs so editing one word re-executes only what is downstream of
  // it. A ref rather than state: changing it must not repaint the canvas.
  const memo = useRef(new Map<string, NodeOutputs>());
  const stop = useRef<AbortController | null>(null);

  const [sources, setSources] = useState<SavedSource[]>([]);
  const world = useMemo(() => ({ registry, library, sources }), [registry, library, sources]);

  useEffect(() => onSpend(setSpent), []);
  useEffect(() => {
    setSpent(gateway.spentUsd);
  }, []);
  useEffect(() => onDocChange?.(doc), [doc, onDocChange]);
  // Where we are, not something anyone chose to keep. See open.ts.
  useEffect(() => rememberOpenGraph(doc), [doc]);

  const update = useCallback((next: (d: GraphDoc) => GraphDoc): void => {
    setDoc((d) => next(d));
  }, []);

  const setParams = useCallback(
    (id: string, patch: Record<string, unknown>): void => {
      update((d) => ({
        ...d,
        nodes: d.nodes.map((n) => (n.id === id ? { ...n, params: { ...n.params, ...patch } } : n)),
      }));
      // The answer this node gave was for a different question, so forget it.
      memo.current.clear();
    },
    [update],
  );

  const pick = useCallback(
    async (id: string, key: string, what: 'file' | 'folder'): Promise<void> => {
      if (what === 'folder') {
        const dir = await pickFolder();
        if (dir) setParams(id, { [key]: dir });
        return;
      }
      const [path] = await pickReferences();
      if (!path) return;
      const name = path.split(/[\\/]/).pop() ?? path;
      // The kind comes from the file, not from a dropdown: nobody has ever
      // wanted to tell an app that a .mp4 is a video. All three land together,
      // so a half-set reference never exists.
      const kind = kindOf(name);
      setParams(id, { [key]: path, name, ...(kind ? { kind } : {}) });
    },
    [setParams],
  );

  /* ---------------------------------------------------------- the picture --- */

  /**
   * React Flow's copy of the nodes, kept in state rather than derived.
   *
   * It has to be state because React Flow measures each node and writes the
   * result back onto the node object; a fresh array every render throws that
   * away, and an unmeasured node stays `visibility: hidden` forever. So the
   * graph stays the source of truth for what exists and what it is set to, and
   * this keeps what only the view can know — how big each box turned out.
   */
  const [flowNodes, setFlowNodes, onNodesChangeInternal] = useNodesState<Node>([]);

  /**
   * Membership only.
   *
   * A node object is created when the node appears and is then left alone, so
   * React Flow can measure it and keep the measurement. Everything that changes
   * often — params, run state, handlers — reaches the body through the board
   * context instead, because touching these objects is what made every node
   * invisible twice.
   */
  useEffect(() => {
    setFlowNodes((prev) => {
      const before = new Map(prev.map((n) => [n.id, n]));
      const wanted = doc.nodes.map((n) => n.id).join(' ');
      const have = prev.map((n) => n.id).join(' ');
      if (wanted === have) return prev;

      return doc.nodes.map(
        (n) =>
          before.get(n.id) ?? {
            id: n.id,
            type: 'dialect',
            position: n.at ?? { x: 0, y: 0 },
            // The node type, and nothing else. Static, so this object can stay
            // still and keep the measurement React Flow writes into it.
            data: { type: n.type },
          },
      );
    });
  }, [doc.nodes]);

  /** What each node shows. Rebuilt freely: no measurement rides on it. */
  const faces = useMemo(() => {
    const map = new Map<string, NodeFace>();
    for (const n of doc.nodes) {
      const spec = NODES.get(n.type) as NodeSpec;
      if (!spec) continue;
      const run = runs[n.id];
      map.set(n.id, {
        spec,
        params: { ...spec.defaults, ...n.params },
        state: run?.state ?? 'idle',
        ...(run?.note ? { note: run.note } : {}),
        ...(run?.error ? { error: run.error } : {}),
      });
    }
    return map;
  }, [doc.nodes, runs]);

  const board = useMemo(
    () => ({ world, faces, setParams, pick: (id: string, key: string, what: 'file' | 'folder') => void pick(id, key, what) }),
    [world, faces, setParams, pick],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      doc.edges.map((e) => ({
        id: `${e.from.node}.${e.from.port}->${e.to.node}.${e.to.port}`,
        source: e.from.node,
        sourceHandle: e.from.port,
        target: e.to.node,
        targetHandle: e.to.port,
        // The wire is coloured by what it carries, so a graph can be read
        // without opening anything.
        className: `wire wire-${NODES.get(doc.nodes.find((n) => n.id === e.from.node)?.type ?? '')?.outputs[e.from.port]?.type ?? 'ir'}`,
      })),
    [doc.edges, doc.nodes],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]): void => {
      // The library's own handler first. It owns measurement, and measurement
      // is what decides whether a node is drawn at all.
      onNodesChangeInternal(changes);

      for (const change of changes) {
        if (change.type === 'select' && change.selected) setSelected(change.id);
        if (change.type === 'remove') {
          update((d) => ({
            ...d,
            nodes: d.nodes.filter((n) => n.id !== change.id),
            edges: d.edges.filter((e) => e.from.node !== change.id && e.to.node !== change.id),
          }));
        }
      }
    },
    [update, onNodesChangeInternal],
  );

  /**
   * Positions land in the document when the drag ends, not during it.
   *
   * Writing on every mouse move would rebuild the node list under the cursor
   * sixty times a second, which is both wasteful and a good way to fight the
   * drag it is trying to record.
   */
  const onNodeDragStop = useCallback((): void => {
    setFlowNodes((ns) => {
      const at = new Map(ns.map((n) => [n.id, n.position]));
      update((d) => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, at: at.get(n.id) ?? n.at })) }));
      return ns;
    });
  }, [update]);

  /**
   * Whether a wire being dragged can land.
   *
   * Answered while the mouse is still moving, so a connection that could not
   * carry anything is never made — the alternative is finding out in the middle
   * of a run that has already spent money.
   */
  const isValid = useCallback(
    (c: Connection | Edge): boolean => {
      const from = NODES.get(doc.nodes.find((n) => n.id === c.source)?.type ?? '');
      const to = NODES.get(doc.nodes.find((n) => n.id === c.target)?.type ?? '');
      const out = from?.outputs[c.sourceHandle ?? ''];
      const into = to?.inputs[c.targetHandle ?? ''];
      if (!out || !into) return false;
      return canConnect(out.type, into.type);
    },
    [doc.nodes],
  );

  const onConnect = useCallback(
    (c: Connection): void => {
      const from = NODES.get(doc.nodes.find((n) => n.id === c.source)?.type ?? '');
      const to = NODES.get(doc.nodes.find((n) => n.id === c.target)?.type ?? '');
      const out = from?.outputs[c.sourceHandle ?? ''];
      const into = to?.inputs[c.targetHandle ?? ''];
      if (!out || !into) return;

      if (!canConnect(out.type, into.type)) return;
      setRefusal(null);
      update((d) => ({
        ...d,
        edges: [
          ...d.edges,
          {
            from: { node: c.source, port: c.sourceHandle ?? 'out' },
            to: { node: c.target, port: c.targetHandle ?? 'in' },
          },
        ],
      }));
      memo.current.clear();
    },
    [doc.nodes, update],
  );

  /**
   * Why a wire would not stick.
   *
   * `isValidConnection` refuses the drop before `onConnect` is ever called, so
   * a mismatched wire simply falls on the floor and nothing says why. This runs
   * whichever way the drag ended, and is the only place the refusal can be
   * explained — which matters, because "it did not work" is the least useful
   * thing an interface can say.
   */
  const onConnectEnd = useCallback(
    (_event: unknown, state: { isValid?: boolean | null; fromHandle?: unknown; toHandle?: unknown }): void => {
      if (state.isValid) {
        setRefusal(null);
        return;
      }
      const from = state.fromHandle as { nodeId?: string; id?: string | null } | null;
      const to = state.toHandle as { nodeId?: string; id?: string | null } | null;
      // Dropped on empty canvas rather than on a socket: nothing was refused,
      // the drag was just abandoned.
      if (!from || !to) return;

      const out = NODES.get(doc.nodes.find((n) => n.id === from.nodeId)?.type ?? '')?.outputs[
        from.id ?? ''
      ];
      const into = NODES.get(doc.nodes.find((n) => n.id === to.nodeId)?.type ?? '')?.inputs[
        to.id ?? ''
      ];
      if (out && into) setRefusal(refusalFor(out.type, into.type) ?? null);
    },
    [doc.nodes],
  );

  /**
   * Put a graph on the canvas. Whatever ran before belonged to another graph.
   *
   * The view's nodes are dropped rather than reconciled, because node objects
   * are reused by id and two unrelated graphs can easily share one — both of
   * the built-in examples have a `compile-1`. Reusing it kept the old position
   * and drew the node in the middle of the new graph.
   */
  const load = useCallback((next: GraphDoc): void => {
    setFlowNodes([]);
    setDoc(next);
    setRuns({});
    setOutputs(new Map());
    setSelected(null);
    setRefusal(null);
    memo.current.clear();
    setOpening(false);
  }, [setFlowNodes]);

  /**
   * Record one field override on the selected Edit fields node.
   *
   * The edit lands in the graph rather than in a panel, so it is saved with
   * everything else and a graph sent to someone carries the corrections that
   * were made to it.
   */
  const setField = useCallback(
    (path: string, value: unknown): void => {
      if (!selected) return;
      const before = (doc.nodes.find((n) => n.id === selected)?.params?.set ?? {}) as Record<
        string,
        unknown
      >;
      setParams(selected, { set: { ...before, [path]: value } });
    },
    [selected, doc.nodes, setParams],
  );

  const refreshSaved = useCallback((): void => {
    void listGraphs()
      .then((all) => setSaved(all.filter((g) => g.id !== OPEN_ID)))
      .catch(() => setSaved([]));
  }, []);

  useEffect(refreshSaved, [refreshSaved]);

  // Kept readings are a shelf to drag from, not part of the build.
  useEffect(() => {
    void listSources().then(setSources).catch(() => setSources([]));
  }, []);

  /**
   * Keep this graph under the name it carries.
   *
   * The name is the identity, so saving twice overwrites rather than piling up
   * near-identical files — the same rule the templates and sources follow.
   */
  const keep = useCallback(async (): Promise<void> => {
    const name = doc.name?.trim() || 'graph';
    try {
      await saveGraph(idFor(name), { ...doc, name });
      setOpening(false);
      refreshSaved();
    } catch (err) {
      setRefusal((err as Error).message);
    }
  }, [doc, refreshSaved]);

  const addNode = useCallback(
    (type: string): void => {
      update((d) => {
        const taken = new Set(d.nodes.map((n) => n.id));
        // Dropped where there is room rather than on top of the last one.
        const x = 60 + (d.nodes.length % 4) * 260;
        const y = 60 + Math.floor(d.nodes.length / 4) * 220;
        return { ...d, nodes: [...d.nodes, { id: freshId(type, taken), type, at: { x, y } }] };
      });
      setAdding(false);
    },
    [update],
  );

  /* -------------------------------------------------------------- the run --- */

  const problems = useMemo(() => checkGraph(doc, NODES), [doc]);
  const blocking = problems.filter((p) => p.fatal);
  const willSpend = useMemo(() => spendingNodes(doc, NODES), [doc]);

  const run = useCallback(async (): Promise<void> => {
    if (running || blocking.length > 0 || doc.nodes.length === 0) return;

    setRunning(true);
    setRefusal(null);
    const controller = new AbortController();
    stop.current = controller;

    // Cost per node is a delta around it. The gateway is the only thing that
    // knows what was actually billed, and a cached answer bills nothing — which
    // is exactly what the canvas should be able to show.
    let mark = gateway.spentUsd;
    const started = new Map<string, number>();

    const onEvent = (e: GraphRunEvent): void => {
      setRuns((r) => {
        if (e.phase === 'start') {
          started.set(e.node, gateway.spentUsd);
          return { ...r, [e.node]: { state: 'running' } };
        }
        if (e.phase === 'cached') {
          return { ...r, [e.node]: { state: 'cached', usd: 0, note: 'already known' } };
        }
        if (e.phase === 'failed') {
          return { ...r, [e.node]: { state: 'failed', ...(e.error ? { error: e.error } : {}) } };
        }
        const usd = gateway.spentUsd - (started.get(e.node) ?? gateway.spentUsd);
        return {
          ...r,
          [e.node]: {
            state: 'done',
            usd,
            note:
              (e.times && e.times > 1 ? `${e.times} times` : '') +
              (usd > 0 ? `${e.times && e.times > 1 ? ', ' : ''}$${usd.toFixed(4)}` : ''),
          },
        };
      });
    };

    try {
      const result = await runGraph(
        doc,
        NODES,
        {
          gateway,
          registry: registry.registry,
          library,
          resolve: resolveSource,
          signal: controller.signal,
        },
        { memo: memo.current, onEvent },
      );
      setOutputs(result.outputs);
      // Aim the inspector at something worth reading without being asked.
      if (!selected) setSelected(sinksOf(doc)[0] ?? null);
    } catch (err) {
      setRefusal((err as Error).message);
    } finally {
      mark = gateway.spentUsd - mark;
      void mark;
      stop.current = null;
      setRunning(false);
    }
  }, [doc, running, blocking.length, registry, library, selected]);

  const selectedNode = doc.nodes.find((n) => n.id === selected);

  return (
    <div className="graph">
      <header className="run-bar">
        <button
          type="button"
          className="run"
          disabled={running || blocking.length > 0 || doc.nodes.length === 0}
          onClick={() => void run()}
        >
          {running ? 'Running…' : 'Run'}
        </button>
        {running ? (
          <button type="button" className="ghost" onClick={() => stop.current?.abort()}>
            Stop
          </button>
        ) : null}

        <div className="add">
          <button type="button" className="ghost" onClick={() => setAdding((a) => !a)}>
            Add node
          </button>
          {adding ? (
            <ul className="add-menu">
              {(['in', 'read', 'compose', 'shape', 'out'] as const).map((group) => (
                <li key={group}>
                  <b>{group}</b>
                  <ul>
                    {[...NODES.values()]
                      .filter((s) => s.group === group)
                      .map((s) => (
                        <li key={s.type}>
                          <button type="button" onClick={() => addNode(s.type)}>
                            {s.title}
                            {s.spends ? <i className="node-spends" /> : null}
                          </button>
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="add">
          <button type="button" className="ghost" onClick={() => setOpening((o) => !o)}>
            Graphs
          </button>
          {opening ? (
            <ul className="add-menu graph-menu">
              <li>
                <b>this one</b>
                <ul>
                  <li>
                    <button type="button" onClick={() => void keep()}>
                      Save
                    </button>
                  </li>
                  <li>
                    <button type="button" onClick={() => void openGraphsFolder()}>
                      Show the folder
                    </button>
                  </li>
                </ul>
              </li>
              <li>
                <b>examples</b>
                <ul>
                  {EXAMPLES.map((ex) => (
                    <li key={ex.id}>
                      <button type="button" onClick={() => load(ex.doc)}>
                        {ex.doc.name ?? ex.id}
                        <span className="add-cost">{ex.about}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
              <li>
                <b>saved</b>
                <ul>
                  {saved.length === 0 ? (
                    <li>
                      <span className="add-empty">none yet</span>
                    </li>
                  ) : (
                    saved.map((g) => (
                      <li key={g.id}>
                        <button type="button" onClick={() => load(g.doc)}>
                          {g.doc.name ?? g.id}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </li>
            </ul>
          ) : null}
        </div>

        <span className="spacer" />

        {willSpend.length > 0 ? (
          <span className="will-spend" title="Nodes that can spend. Cached ones will not.">
            {willSpend.length} paid step{willSpend.length === 1 ? '' : 's'}
          </span>
        ) : null}
        <span className="spend" title={`Budget $${BUDGET_USD.toFixed(2)}`}>
          ${spent.toFixed(4)}
        </span>
      </header>

      {blocking.length > 0 && !running ? (
        <p className="graph-problem">{blocking[0]?.message}</p>
      ) : null}
      {refusal ? <p className="graph-problem">{refusal}</p> : null}

      <div className="graph-body">
        <BoardProvider value={board}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValid}
          onPaneClick={() => setSelected(null)}
          proOptions={{ hideAttribution: true }}
          fitView
        >
          <Background gap={18} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        </BoardProvider>

        <Inspector
          node={selectedNode}
          spec={selectedNode ? NODES.get(selectedNode.type) : undefined}
          outputs={selected ? outputs.get(selected) : undefined}
          run={selected ? runs[selected] : undefined}
          {...(selected
            ? { onSet: setField, onParam: (k: string, v: unknown) => setParams(selected, { [k]: v }) }
            : {})}
        />
      </div>
    </div>
  );
}

export function Editor(props: EditorProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}
