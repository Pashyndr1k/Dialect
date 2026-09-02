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

  // Where we are, not something anyone chose to keep. See open.ts.
  useEffect(() => rememberOpenGraph(doc), [doc]);

  const refreshSaved = useCallback((): void => {
    void listGraphs()
      .then((all) => setSaved(all.filter((g) => g.id !== OPEN_ID)))
      .catch(() => setSaved([]));
  }, []);

  useEffect(refreshSaved, [refreshSaved]);

  /** Any change that makes what was worked out stale. */
  const edit = useCallback(
    (next: (d: GraphDoc) => GraphDoc): void => {
      setDoc(next);
      onChanged(false);
    },
    [onChanged],
  );

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

  const moved = useCallback((at: Map<string, { x: number; y: number }>): void => {
    // Not an edit: moving a node changes the picture and nothing about what it
    // would produce, so nothing is forgotten.
    setDoc((d) => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, at: at.get(n.id) ?? n.at })) }));
  }, []);

  const open = useCallback(
    (next: GraphDoc): void => {
      setDoc(next);
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
    const name = doc.name?.trim() || 'graph';
    await saveGraph(idFor(name), { ...doc, name });
    refreshSaved();
  }, [doc, refreshSaved]);

  return { doc, saved, setParams, addNode, removeNode, connect, open, moved, keep };
}
