/**
 * Checking a graph before it runs.
 *
 * Two callers, two different needs. The editor asks *can this one connection be
 * made* while a wire is being dragged, and needs an answer in a frame. A run
 * asks *is the whole thing sound* and can afford to look at everything.
 *
 * Both answer in terms of ports and node titles, never types and ids, because
 * the person reading the answer is looking at a picture.
 */

import {
  BadConnectionError,
  type GraphDoc,
  type NodeSpec,
  type PortType,
  PORT_LABEL,
} from './types.ts';
import { sinksOf } from './run.ts';

export interface Problem {
  node: string;
  message: string;
  /** A graph with one of these cannot be run at all. */
  fatal: boolean;
}

/**
 * Whether a wire from one port can land on another.
 *
 * Exact match only. There is no widening and no coercion: a reading is not a
 * document that happens to be unfinished, and letting the two connect would
 * move the failure from the moment of drawing the wire to the middle of a run
 * that has already spent money.
 */
export const canConnect = (from: PortType, to: PortType): boolean => from === to;

export function assertConnectable(from: PortType, to: PortType): void {
  if (!canConnect(from, to)) throw new BadConnectionError(from, to);
}

/** Why a connection was refused, in words for a tooltip. */
export const refusalFor = (from: PortType, to: PortType): string | undefined =>
  canConnect(from, to)
    ? undefined
    : `A ${PORT_LABEL[from]} does not fit a ${PORT_LABEL[to]} socket.`;

export function checkGraph(doc: GraphDoc, specs: Map<string, NodeSpec>): Problem[] {
  const problems: Problem[] = [];
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const titleOf = (id: string): string => {
    const node = byId.get(id);
    return (node && specs.get(node.type)?.title) ?? id;
  };

  for (const node of doc.nodes) {
    if (!specs.get(node.type)) {
      problems.push({
        node: node.id,
        fatal: true,
        message: `This build has no node called "${node.type}".`,
      });
    }
  }

  for (const edge of doc.edges) {
    const fromNode = byId.get(edge.from.node);
    const toNode = byId.get(edge.to.node);
    if (!fromNode || !toNode) {
      problems.push({
        node: edge.to.node,
        fatal: true,
        message: 'A wire is connected to a node that is not here any more.',
      });
      continue;
    }

    const fromPort = specs.get(fromNode.type)?.outputs[edge.from.port];
    const toPort = specs.get(toNode.type)?.inputs[edge.to.port];
    if (!fromPort || !toPort) {
      problems.push({
        node: edge.to.node,
        fatal: true,
        message: `"${titleOf(edge.from.node)}" and "${titleOf(edge.to.node)}" are joined by a wire between sockets that no longer exist.`,
      });
      continue;
    }

    if (!canConnect(fromPort.type, toPort.type)) {
      problems.push({
        node: edge.to.node,
        fatal: true,
        message: `${refusalFor(fromPort.type, toPort.type)!} (from "${titleOf(edge.from.node)}")`,
      });
    }
  }

  // A required input with nothing on it is the most common way a graph is not
  // finished yet, so it is reported per port rather than as one summary.
  for (const node of doc.nodes) {
    const spec = specs.get(node.type);
    if (!spec) continue;
    for (const [port, portSpec] of Object.entries(spec.inputs)) {
      if (portSpec.optional) continue;
      const wired = doc.edges.some((e) => e.to.node === node.id && e.to.port === port);
      if (!wired) {
        problems.push({
          node: node.id,
          fatal: true,
          message: `"${spec.title}" has nothing connected to its ${portSpec.label ?? port}.`,
        });
      }
    }
  }

  // Not fatal: a graph being built has loose ends most of the time, and warning
  // about them while someone is still drawing would be noise.
  if (doc.nodes.length > 0 && sinksOf(doc).length === doc.nodes.length) {
    problems.push({
      node: doc.nodes[0]!.id,
      fatal: false,
      message: 'Nothing is connected yet, so a run would do nothing.',
    });
  }

  return problems;
}

/** What a run gate needs: the fatal ones only. */
export const blockingProblems = (problems: Problem[]): Problem[] => problems.filter((p) => p.fatal);

/**
 * Which nodes would spend money if this graph ran now.
 *
 * Says nothing about the cache — a node that is memoised or whose call the
 * gateway already knows will spend nothing, and that is only discoverable by
 * running. This is the ceiling, which is the honest thing to show before a run.
 */
export function spendingNodes(doc: GraphDoc, specs: Map<string, NodeSpec>): string[] {
  return doc.nodes.filter((n) => specs.get(n.type)?.spends).map((n) => n.id);
}
