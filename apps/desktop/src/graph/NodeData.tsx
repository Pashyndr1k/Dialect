/**
 * What a node shows, kept off the node.
 *
 * React Flow measures every node and writes the size into its own store, and a
 * node it has not measured is drawn `visibility: hidden`. Anything that
 * replaces the node objects is racing that, so the objects here carry an id and
 * a type and nothing else, and change only when a node is added, removed or
 * moved.
 *
 * Everything volatile — what a node is set to, what happened to it last run,
 * the handlers — arrives through this context instead. That keeps the two
 * concerns apart: the graph owns what exists, the board owns what it looks
 * like right now.
 */

import { createContext, useContext } from 'react';
import type { NodeSpec } from '@dialect/core';

import type { World } from './controls.ts';

export type NodeState = 'idle' | 'running' | 'done' | 'cached' | 'failed';

export interface NodeFace {
  spec: NodeSpec;
  params: Record<string, unknown>;
  state: NodeState;
  /** What this node produced last run, in a few words. */
  note?: string;
  error?: string;
}

export interface BoardValue {
  world: World;
  faces: Map<string, NodeFace>;
  setParams: (id: string, patch: Record<string, unknown>) => void;
  pick: (id: string, key: string, what: 'file' | 'folder') => void;
}

const BoardContext = createContext<BoardValue | null>(null);

export const BoardProvider = BoardContext.Provider;

export function useBoard(): BoardValue {
  const value = useContext(BoardContext);
  if (!value) throw new Error('A node was rendered outside the board.');
  return value;
}
