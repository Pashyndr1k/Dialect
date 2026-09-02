/**
 * The canvas: a view of the graph, and nothing more.
 *
 * The document lives in `useGraphDoc` and the run in `useRun`. What is left
 * here is the picture — which node objects React Flow is holding, which wires
 * may be drawn, and what is selected — because those are the only things that
 * belong to the screen rather than to the work.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
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
  kindOf,
  refusalFor,
  sinksOf,
  type GraphDoc,
  type Library,
  type LoadedRegistry,
  type NodeSpec,
  type PortType,
  type SavedSource,
} from '@dialect/core';

import { NODES } from './host.ts';
import { NodeBody } from './Node.tsx';
import { BoardProvider, type NodeFace } from './NodeData.tsx';
import { Inspector } from './Inspector.tsx';
import { RunBar } from './RunBar.tsx';
import { useRun } from './useRun.ts';
import { useGraphDoc } from './useGraphDoc.ts';
import { pickFolder, pickReferences } from '../store.ts';
import { listSources } from '../sources.ts';
import type { SavedGraph } from '../graphs.ts';

const nodeTypes = { dialect: NodeBody };

export interface EditorProps {
  registry: LoadedRegistry;
  library: Library;
  doc?: GraphDoc;
  /**
   * The title bar owns the name and the Save button, so it needs to see the
   * document and be able to act on it. Handed up rather than duplicated: two
   * places holding a name is two places for it to be wrong.
   */
  onGraph?: (state: {
    name: string | undefined;
    dirty: boolean;
    rename: (name: string) => void;
    save: () => void;
    open: (doc: GraphDoc) => void;
    saved: SavedGraph[];
  }) => void;
}

/** One end of a connection being dragged, as React Flow reports it. */
type End = { nodeId?: string | undefined; id?: string | null | undefined } | null;

/** What a named port on a named node carries, if both exist. */
function portOf(
  doc: GraphDoc,
  nodeId: string | null | undefined,
  port: string | null | undefined,
  side: 'in' | 'out',
): PortType | undefined {
  const spec = NODES.get(doc.nodes.find((n) => n.id === nodeId)?.type ?? '');
  return (side === 'out' ? spec?.outputs : spec?.inputs)?.[port ?? '']?.type;
}

function Board({ registry, library, doc: initial, onGraph }: EditorProps): React.ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [flowNodes, setFlowNodes, onNodesChangeInternal] = useNodesState<Node>([]);

  /**
   * The document tells the run to forget, through a ref.
   *
   * The two need each other — a change makes the last run stale, and the run
   * needs the document to run — so one of them has to be reached indirectly.
   * A ref rather than a dependency, because depending on each other's identity
   * would rebuild both on every keystroke.
   */
  const forget = useRef<(all?: boolean) => void>(() => {});

  /**
   * Opening a graph drops the view's nodes rather than reconciling them.
   *
   * Node objects are reused by id and two unrelated graphs can easily share one
   * — both built-in examples have a `compile-1`. Reusing it kept the old
   * position and drew the node in the middle of the new graph.
   */
  const onDocChanged = useCallback(
    (opened: boolean): void => {
      forget.current(opened);
      if (opened) {
        setFlowNodes([]);
        setSelected(null);
      }
    },
    [setFlowNodes],
  );

  const graph = useGraphDoc(initial, onDocChanged);
  const { doc } = graph;
  const run = useRun(doc, registry, library);
  forget.current = run.forget;

  const world = useMemo(() => ({ registry, library, sources }), [registry, library, sources]);

  /**
   * Undo and redo on the keys every editor uses.
   *
   * Skipped while a field has focus, because inside a text box those keys
   * already mean something and taking them would be worse than not having them.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) graph.redo();
      else graph.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [graph]);

  // Kept readings are a shelf to drag from, not part of the build.
  useEffect(() => {
    void listSources().then(setSources).catch(() => setSources([]));
  }, []);

  const pick = useCallback(
    async (id: string, key: string, what: 'file' | 'folder'): Promise<void> => {
      if (what === 'folder') {
        const dir = await pickFolder();
        if (dir) graph.setParams(id, { [key]: dir });
        return;
      }
      const [path] = await pickReferences();
      if (!path) return;
      const name = path.split(/[\\/]/).pop() ?? path;
      // The kind comes from the file, not from a dropdown: nobody has ever
      // wanted to tell an app that a .mp4 is a video. All three land together,
      // so a half-set reference never exists.
      const kind = kindOf(name);
      graph.setParams(id, { [key]: path, name, ...(kind ? { kind } : {}) });
    },
    [graph],
  );

  /* ---------------------------------------------------------- the picture --- */

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
      if (doc.nodes.map((n) => n.id).join(' ') === prev.map((n) => n.id).join(' ')) return prev;

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
  }, [doc.nodes, setFlowNodes]);

  /** What each node shows. Rebuilt freely: no measurement rides on it. */
  const faces = useMemo(() => {
    const map = new Map<string, NodeFace>();
    for (const n of doc.nodes) {
      const spec = NODES.get(n.type) as NodeSpec;
      if (!spec) continue;
      const state = run.runs[n.id];
      map.set(n.id, {
        spec,
        params: { ...spec.defaults, ...n.params },
        state: state?.state ?? 'idle',
        ...(state?.note ? { note: state.note } : {}),
        ...(state?.error ? { error: state.error } : {}),
      });
    }
    return map;
  }, [doc.nodes, run.runs]);

  const board = useMemo(
    () => ({
      world,
      faces,
      setParams: graph.setParams,
      pick: (id: string, key: string, what: 'file' | 'folder') => void pick(id, key, what),
    }),
    [world, faces, graph.setParams, pick],
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
        className: `wire wire-${portOf(doc, e.from.node, e.from.port, 'out') ?? 'ir'}`,
      })),
    [doc],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]): void => {
      // The library's own handler first. It owns measurement, and measurement
      // is what decides whether a node is drawn at all.
      onNodesChangeInternal(changes);

      for (const change of changes) {
        if (change.type === 'select' && change.selected) setSelected(change.id);
        if (change.type === 'remove') graph.removeNode(change.id);
      }
    },
    [onNodesChangeInternal, graph],
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
      graph.moved(new Map(ns.map((n) => [n.id, n.position])));
      return ns;
    });
  }, [setFlowNodes, graph]);

  /**
   * Whether a wire being dragged can land.
   *
   * Answered while the mouse is still moving, so a connection that could not
   * carry anything is never made — the alternative is finding out in the middle
   * of a run that has already spent money.
   */
  const isValid = useCallback(
    (c: Connection | Edge): boolean => {
      const out = portOf(doc, c.source, c.sourceHandle, 'out');
      const into = portOf(doc, c.target, c.targetHandle, 'in');
      return out !== undefined && into !== undefined && canConnect(out, into);
    },
    [doc],
  );

  const onConnect = useCallback(
    (c: Connection): void => {
      if (!isValid(c)) return;
      run.say(null);
      graph.connect(
        { node: c.source, port: c.sourceHandle ?? 'out' },
        { node: c.target, port: c.targetHandle ?? 'in' },
      );
    },
    [isValid, graph, run],
  );

  /**
   * Why a wire would not stick.
   *
   * `isValidConnection` refuses the drop before `onConnect` is ever called, so
   * a mismatched wire simply falls on the floor and nothing says why. This runs
   * whichever way the drag ended, and is the only place the refusal can be
   * explained — "it did not work" being the least useful thing an interface can
   * say.
   */
  const onConnectEnd = useCallback(
    (_event: unknown, state: { isValid?: boolean | null; fromHandle?: End; toHandle?: End }) => {
      if (state.isValid) return run.say(null);
      // Dropped on empty canvas rather than on a socket: nothing was refused,
      // the drag was just abandoned.
      if (!state.fromHandle || !state.toHandle) return;

      const out = portOf(doc, state.fromHandle.nodeId, state.fromHandle.id, 'out');
      const into = portOf(doc, state.toHandle.nodeId, state.toHandle.id, 'in');
      if (out && into) run.say(refusalFor(out, into) ?? null);
    },
    [doc, run],
  );

  // Kept in a ref and reported on change, so the title bar always has the
  // current handles without the editor re-rendering when the bar does.
  useEffect(() => {
    onGraph?.({
      name: doc.name,
      dirty: graph.dirty,
      rename: graph.rename,
      save: () => void graph.keep().catch((err: Error) => run.say(err.message)),
      open: graph.open,
      saved: graph.saved,
    });
  }, [doc.name, graph.dirty, graph.rename, graph.keep, graph.open, graph.saved, onGraph, run]);

  const node = doc.nodes.find((n) => n.id === selected);

  return (
    <div className="graph">
      <RunBar
        running={run.running}
        canRun={run.blocking.length === 0 && doc.nodes.length > 0}
        spent={run.spent}
        willSpend={run.willSpend.length}
        onRun={() => {
          // Aim the inspector at something worth reading without being asked.
          void run.go().then(() => setSelected((s) => s ?? sinksOf(doc)[0] ?? null));
        }}
        onStop={run.stop}
        onAdd={graph.addNode}
      />

      {run.blocking.length > 0 && !run.running ? (
        <p className="graph-problem">{run.blocking[0]?.message}</p>
      ) : null}
      {run.refusal ? <p className="graph-problem">{run.refusal}</p> : null}

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
            {/* Where you are, in a graph too big to see at once. Hidden while
                there is nothing to get lost in. */}
            {doc.nodes.length > 3 ? (
              <MiniMap pannable zoomable nodeStrokeWidth={2} className="graph-map" />
            ) : null}
          </ReactFlow>
        </BoardProvider>

        <Inspector
          node={node}
          spec={node ? NODES.get(node.type) : undefined}
          outputs={selected ? run.outputs.get(selected) : undefined}
          run={selected ? run.runs[selected] : undefined}
          {...(selected
            ? {
                onSet: (path: string, value: unknown) =>
                  graph.setParams(selected, {
                    set: { ...((node?.params?.set ?? {}) as Record<string, unknown>), [path]: value },
                  }),
                onParam: (k: string, v: unknown) => graph.setParams(selected, { [k]: v }),
              }
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
