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

import { isOpenId } from './open.ts';
import { idFor, listGraphs, saveGraph, type SavedGraph } from '../graphs.ts';

export const EMPTY_GRAPH: GraphDoc = { version: 1, nodes: [], edges: [] };

/**
 * Everything about one open graph that has to survive being looked away from.
 *
 * The document, obviously — but the history too. A tab you come back to with
 * its undo stack emptied is not a tab, it is a document picker with a row of
 * buttons, and the difference is exactly whether the work you did before you
 * switched can still be taken back.
 */
export interface GraphSnapshot {
  doc: GraphDoc;
  past: GraphDoc[];
  future: GraphDoc[];
  /** The document as last written, as JSON. What the dirty dot compares to. */
  written: string;
}

export const snapshotOf = (doc: GraphDoc): GraphSnapshot => ({
  doc,
  past: [],
  future: [],
  written: JSON.stringify(doc),
});

export const BLANK_SNAPSHOT = (): GraphSnapshot => snapshotOf(EMPTY_GRAPH);

/** Whether a snapshot has changes it has not seen written. */
export const isDirty = (snapshot: GraphSnapshot): boolean =>
  JSON.stringify(snapshot.doc) !== snapshot.written;

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
  addNode: (type: string, at?: { x: number; y: number }) => void;
  /** The same node again, offset, wires not carried over. */
  duplicateNode: (id: string) => void;
  removeNode: (id: string) => void;
  connect: (from: { node: string; port: string }, to: { node: string; port: string }) => void;
  /** Positions, written back when a drag ends rather than during it. */
  moved: (at: Map<string, { x: number; y: number }>) => void;
  keep: () => Promise<void>;
  /** Read the saved list again, after something outside changed it. */
  refresh: () => void;
  /** Everything a tab has to hold on to while you are looking at another one. */
  snapshot: GraphSnapshot;
}

export function useGraphDoc(
  initial: GraphSnapshot | undefined,
  onChanged: () => void,
): GraphDocApi {
  const [doc, setDoc] = useState<GraphDoc>(initial?.doc ?? EMPTY_GRAPH);
  const [saved, setSaved] = useState<SavedGraph[]>([]);
  /**
   * What this graph looked like when it was last written or opened.
   *
   * Seeded from what the tab opened with, not left empty: otherwise nothing
   * counts as changed until the first save, which is exactly the stretch where
   * knowing would matter most.
   */
  const [written, setWritten] = useState<string>(
    () => initial?.written ?? JSON.stringify(initial?.doc ?? EMPTY_GRAPH),
  );

  /**
   * Where you have been, and where you were before you came back.
   *
   * A graph is plain JSON that fully describes itself, so history is a stack of
   * whole documents rather than a list of operations to invert. That is a few
   * kilobytes each and correct by construction — an undo cannot drift out of
   * step with what it is undoing.
   *
   * Seeded from the snapshot, so switching tabs and coming back does not empty
   * it. The stacks belong to the graph, not to the screen.
   */
  const [past, setPast] = useState<GraphDoc[]>(initial?.past ?? []);
  const [future, setFuture] = useState<GraphDoc[]>(initial?.future ?? []);

  /** Deep enough to get out of trouble, shallow enough not to hold a session. */
  const DEPTH = 50;

  const refreshSaved = useCallback((): void => {
    void listGraphs()
      // Neither the graph that was simply open in a tab nor its neighbours are
      // things anyone chose to keep.
      .then((all) => setSaved(all.filter((g) => !isOpenId(g.id))))
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
      onChanged();
    },
    [doc, onChanged],
  );

  const undo = useCallback((): void => {
    const back = past[past.length - 1];
    if (!back) return;
    setFuture((f) => [doc, ...f].slice(0, DEPTH));
    setPast((p) => p.slice(0, -1));
    setDoc(back);
    onChanged();
  }, [past, doc, onChanged]);

  const redo = useCallback((): void => {
    const forward = future[0];
    if (!forward) return;
    setPast((p) => [...p.slice(-DEPTH + 1), doc]);
    setFuture((f) => f.slice(1));
    setDoc(forward);
    onChanged();
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
    (type: string, at?: { x: number; y: number }): void =>
      edit((d) => {
        const taken = new Set(d.nodes.map((n) => n.id));
        // Where you pointed, when you pointed — a right-click on the canvas
        // means "here". Otherwise somewhere with room, rather than on top of
        // the last one.
        const spot = at ?? {
          x: 60 + (d.nodes.length % 4) * 260,
          y: 60 + Math.floor(d.nodes.length / 4) * 220,
        };
        return { ...d, nodes: [...d.nodes, { id: freshId(type, taken), type, at: spot }] };
      }),
    [edit],
  );

  /**
   * A copy of one node, settings and all, a little down and to the right.
   *
   * Its wires are not copied. A duplicate of a node that was wired into the
   * middle of a graph would silently double whatever ran through it, and the
   * usual reason to duplicate is to try a second version of the same settings
   * — which wants its own wires, chosen deliberately.
   */
  const duplicateNode = useCallback(
    (id: string): void =>
      edit((d) => {
        const from = d.nodes.find((n) => n.id === id);
        if (!from) return d;
        const taken = new Set(d.nodes.map((n) => n.id));
        const copy = {
          ...from,
          id: freshId(from.type, taken),
          at: { x: (from.at?.x ?? 0) + 40, y: (from.at?.y ?? 0) + 40 },
          ...(from.params ? { params: { ...from.params } } : {}),
        };
        return { ...d, nodes: [...d.nodes, copy] };
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
    duplicateNode,
    removeNode,
    connect,
    moved,
    keep,
    refresh: refreshSaved,
    snapshot: { doc, past, future, written },
  };
}
