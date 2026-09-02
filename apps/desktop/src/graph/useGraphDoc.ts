/**
 * The document, and the things done to it.
 *
 * Separate from the picture of it. The graph is what gets saved, run and sent
 * to someone; React Flow is a view. Keeping the two apart is what stops a
 * second copy of the truth appearing — and it is what this file's neighbour
 * claims in its first paragraph, so it may as well be true.
 *
 * Nothing here knows about positions on screen, measurement, or selection.
 */

import { useCallback, useEffect, useState } from 'react';
import type { GraphDoc } from '@dialect/core';

import { OPEN_ID, rememberOpenGraph } from './open.ts';
import { idFor, listGraphs, saveGraph, type SavedGraph } from '../graphs.ts';

const EMPTY: GraphDoc = { version: 1, nodes: [], edges: [] };

/** A new id that reads as what it is, so a saved graph can be followed by eye. */
const freshId = (type: string, taken: Set<string>): string => {
  for (let n = 1; ; n += 1) {
    const id = `${type}-${n}`;
    if (!taken.has(id)) return id;
  }
};

export interface GraphDocApi {
  doc: GraphDoc;
  /** Graphs someone kept, minus the one that was simply open. */
  saved: SavedGraph[];
  /** Changed since it was last written under its name. */
  dirty: boolean;
  rename: (name: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setParams: (id: string, patch: Record<string, unknown>) => void;
  addNode: (type: string) => void;
  removeNode: (id: string) => void;
  connect: (from: { node: string; port: string }, to: { node: string; port: string }) => void;
  open: (next: GraphDoc) => void;
  /** Positions, written back when a drag ends rather than during it. */
  moved: (at: Map<string, { x: number; y: number }>) => void;
  keep: () => Promise<void>;
}

export function useGraphDoc(
  initial: GraphDoc | undefined,
  onChanged: (opened: boolean) => void,
): GraphDocApi {
  const [doc, setDoc] = useState<GraphDoc>(initial ?? EMPTY);
  const [saved, setSaved] = useState<SavedGraph[]>([]);
  /**
   * What this graph looked like when it was last written or opened.
   *
   * Seeded from what the window opened with, not left empty: otherwise nothing
   * counts as changed until the first save, which is exactly the stretch where
   * knowing would matter most.
   */
  const [written, setWritten] = useState<string>(() => JSON.stringify(initial ?? EMPTY));

  /**
   * Where you have been, and where you were before you came back.
   *
   * A graph is plain JSON that fully describes itself, so history is a stack of
   * whole documents rather than a list of operations to invert. That is a few
   * kilobytes each and correct by construction — an undo cannot drift out of
   * step with what it is undoing.
   */
  const [past, setPast] = useState<GraphDoc[]>([]);
  const [future, setFuture] = useState<GraphDoc[]>([]);

  /** Deep enough to get out of trouble, shallow enough not to hold a session. */
  const DEPTH = 50;

  // Where we are, not something anyone chose to keep. See open.ts.
  useEffect(() => rememberOpenGraph(doc), [doc]);

  const refreshSaved = useCallback((): void => {
    void listGraphs()
      .then((all) => setSaved(all.filter((g) => g.id !== OPEN_ID)))
      .catch(() => setSaved([]));
  }, []);

  useEffect(refreshSaved, [refreshSaved]);

  /**
   * Any change that makes what was worked out stale, and that can be taken back.
   *
   * Written flat rather than as nested setters. The first version called
   * setFuture inside setPast inside setDoc, which is a side effect inside a
   * state updater — React runs those twice in development and the redo stack
   * came out doubled and unusable. Reading the current values from the closure
   * costs one dependency and is simply correct.
   */
  const edit = useCallback(
    (next: (d: GraphDoc) => GraphDoc): void => {
      setPast((p) => [...p.slice(-DEPTH + 1), doc]);
      // Doing something new is what ends a redo trail; keeping it would let you
      // redo your way into a graph that never existed.
      setFuture([]);
      setDoc(next);
      onChanged(false);
    },
    [doc, onChanged],
  );

  const undo = useCallback((): void => {
    const back = past[past.length - 1];
    if (!back) return;
    setFuture((f) => [doc, ...f].slice(0, DEPTH));
    setPast((p) => p.slice(0, -1));
    setDoc(back);
    onChanged(false);
  }, [past, doc, onChanged]);

  const redo = useCallback((): void => {
    const forward = future[0];
    if (!forward) return;
    setPast((p) => [...p.slice(-DEPTH + 1), doc]);
    setFuture((f) => f.slice(1));
    setDoc(forward);
    onChanged(false);
  }, [future, doc, onChanged]);

  const setParams = useCallback(
    (id: string, patch: Record<string, unknown>): void =>
      edit((d) => ({
        ...d,
        nodes: d.nodes.map((n) => (n.id === id ? { ...n, params: { ...n.params, ...patch } } : n)),
      })),
    [edit],
  );

  const addNode = useCallback(
    (type: string): void =>
      edit((d) => {
        const taken = new Set(d.nodes.map((n) => n.id));
        // Dropped where there is room rather than on top of the last one.
        const x = 60 + (d.nodes.length % 4) * 260;
        const y = 60 + Math.floor(d.nodes.length / 4) * 220;
        return { ...d, nodes: [...d.nodes, { id: freshId(type, taken), type, at: { x, y } }] };
      }),
    [edit],
  );

  const removeNode = useCallback(
    (id: string): void =>
      edit((d) => ({
        ...d,
        nodes: d.nodes.filter((n) => n.id !== id),
        // A wire to nowhere is not a wire.
        edges: d.edges.filter((e) => e.from.node !== id && e.to.node !== id),
      })),
    [edit],
  );

  const connect = useCallback(
    (from: { node: string; port: string }, to: { node: string; port: string }): void =>
      edit((d) => ({ ...d, edges: [...d.edges, { from, to }] })),
    [edit],
  );

  const moved = useCallback(
    (at: Map<string, { x: number; y: number }>): void => {
      // Recorded in history — a drag is something you would expect to take back
      // — but nothing is forgotten by it: where a node sits changes the picture
      // and not what it would produce.
      setPast((p) => [...p.slice(-DEPTH + 1), doc]);
      setFuture([]);
      setDoc((d) => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, at: at.get(n.id) ?? n.at })) }));
    },
    [doc],
  );

  const open = useCallback(
    (next: GraphDoc): void => {
      setDoc(next);
      setWritten(JSON.stringify(next));
      setPast([]);
      setFuture([]);
      onChanged(true);
    },
    [onChanged],
  );

  /**
   * Keep this graph under the name it carries.
   *
   * The name is the identity, so saving twice overwrites rather than piling up
   * near-identical files — the same rule the templates and sources follow.
   */
  const keep = useCallback(async (): Promise<void> => {
    const name = doc.name?.trim();
    if (!name) throw new Error('Give this graph a name first — click its title.');
    const kept = { ...doc, name };
    await saveGraph(idFor(name), kept);
    setWritten(JSON.stringify(kept));
    refreshSaved();
  }, [doc, refreshSaved]);

  /** Renaming is a change like any other, and makes it unsaved like any other. */
  const rename = useCallback(
    (name: string): void => setDoc((d) => ({ ...d, name })),
    [],
  );

  const dirty = written !== JSON.stringify(doc);

  return {
    doc,
    saved,
    dirty,
    rename,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    setParams,
    addNode,
    removeNode,
    connect,
    open,
    moved,
    keep,
  };
}
