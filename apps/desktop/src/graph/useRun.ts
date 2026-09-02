/**
 * Running a graph, and everything that follows from a run.
 *
 * Kept apart from the canvas because it owns the money. What a node cost, what
 * has been spent, what would be spent if you pressed the button now — none of
 * that is a drawing concern, and mixing it into one with the picture is how a
 * budget ends up counted twice.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  checkGraph,
  runGraph,
  spendingNodes,
  type GraphDoc,
  type GraphRunEvent,
  type Library,
  type LoadedRegistry,
  type NodeOutputs,
} from '@dialect/core';

import { NODES, resolveSource } from './host.ts';
import { gateway, onSpend } from '../gateway.ts';
import type { NodeState } from './NodeData.tsx';

export interface NodeRun {
  state: NodeState;
  note?: string;
  error?: string;
  /** What this node cost this run. Zero when the answer was already known. */
  usd?: number;
}

export interface Run {
  runs: Record<string, NodeRun>;
  outputs: Map<string, NodeOutputs>;
  running: boolean;
  spent: number;
  refusal: string | null;
  say: (message: string | null) => void;
  /** Fatal problems. A graph with any of these cannot be run at all. */
  blocking: ReturnType<typeof checkGraph>;
  /** Nodes that could spend. Says nothing about what is cached. */
  willSpend: string[];
  go: () => Promise<string[]>;
  stop: () => void;
  /** Forget what was worked out. For an edit, or a different graph. */
  forget: (all?: boolean) => void;
}

export function useRun(doc: GraphDoc, registry: LoadedRegistry, library: Library): Run {
  const [runs, setRuns] = useState<Record<string, NodeRun>>({});
  const [outputs, setOutputs] = useState<Map<string, NodeOutputs>>(new Map());
  const [running, setRunning] = useState(false);
  const [spent, setSpent] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Kept across runs so editing one word re-executes only what is downstream of
  // it. A ref rather than state: changing it must not repaint the canvas.
  const memo = useRef(new Map<string, NodeOutputs>());
  const abort = useRef<AbortController | null>(null);

  useEffect(() => onSpend(setSpent), []);
  useEffect(() => {
    setSpent(gateway.spentUsd);
  }, []);

  const problems = useMemo(() => checkGraph(doc, NODES), [doc]);
  const blocking = useMemo(() => problems.filter((p) => p.fatal), [problems]);
  const willSpend = useMemo(() => spendingNodes(doc, NODES), [doc]);

  const forget = useCallback((all = false): void => {
    memo.current.clear();
    if (all) {
      setRuns({});
      setOutputs(new Map());
      setRefusal(null);
    }
  }, []);

  const go = useCallback(async (): Promise<string[]> => {
    if (running || blocking.length > 0 || doc.nodes.length === 0) return [];

    setRunning(true);
    setRefusal(null);
    const controller = new AbortController();
    abort.current = controller;

    // Cost per node is a delta around it. The gateway is the only thing that
    // knows what was actually billed, and a cached answer bills nothing — which
    // is exactly what the canvas should be able to show.
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
        const times = e.times && e.times > 1 ? `${e.times} times` : '';
        const cost = usd > 0 ? `$${usd.toFixed(4)}` : '';
        return {
          ...r,
          [e.node]: { state: 'done', usd, note: [times, cost].filter(Boolean).join(', ') },
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
      return result.ran;
    } catch (err) {
      setRefusal((err as Error).message);
      return [];
    } finally {
      abort.current = null;
      setRunning(false);
    }
  }, [doc, running, blocking.length, registry, library]);

  const stop = useCallback((): void => abort.current?.abort(), []);

  return {
    runs,
    outputs,
    running,
    spent,
    refusal,
    say: setRefusal,
    blocking,
    willSpend,
    go,
    stop,
    forget,
  };
}
