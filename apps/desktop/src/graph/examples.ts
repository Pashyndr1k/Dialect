/**
 * Graphs the build ships with.
 *
 * Two, and they answer different questions. The first is what the canvas opens
 * on: the shortest thing that does something real, so the first press of Run
 * produces a prompt and costs nothing. The second is every idea in the app in
 * one picture, and it is also the graph that proves the canvas and the panels
 * agree.
 *
 * They are examples, not defaults: opening one replaces what is on the canvas,
 * the same as opening any saved graph.
 */

import type { GraphDoc } from '@dialect/core';

import imageExample from '../example.image.json';

export interface Example {
  id: string;
  doc: GraphDoc;
  /** One line for the menu. It says what it costs, because that is the question. */
  about: string;
}

const STARTER: GraphDoc = {
  version: 1,
  name: 'A document, rendered',
  nodes: [
    {
      id: 'document-1',
      type: 'document',
      at: { x: 40, y: 60 },
      params: { json: JSON.stringify(imageExample, null, 2) },
    },
    { id: 'compile-1', type: 'compile', at: { x: 360, y: 60 }, params: { target: 'nano-banana-2' } },
  ],
  edges: [{ from: { node: 'document-1', port: 'out' }, to: { node: 'compile-1', port: 'ir' } }],
};

/**
 * Two references with different jobs, composed, varied, rendered.
 *
 * The shape the whole design rests on: one reference says who it is, the other
 * says how it looks and nothing about what is in it. A style source showing a
 * snowy street puts no snow in the picture — that is the claim, and this is the
 * graph that tests it against real photographs rather than a fixture.
 *
 * The two Reference nodes arrive empty. Which files they are is the one thing
 * this cannot decide.
 */
const BUNDLE: GraphDoc = {
  version: 1,
  name: 'Two references, eight variations',
  nodes: [
    { id: 'reference-1', type: 'reference', at: { x: 20, y: 40 } },
    { id: 'reference-2', type: 'reference', at: { x: 20, y: 240 } },
    { id: 'read-1', type: 'read', at: { x: 300, y: 40 }, params: { role: 'subject' } },
    { id: 'read-2', type: 'read', at: { x: 300, y: 240 }, params: { role: 'style' } },
    {
      id: 'words-1',
      type: 'words',
      at: { x: 20, y: 440 },
      params: { text: 'the same character, later in the evening' },
    },
    { id: 'compose-1', type: 'compose', at: { x: 580, y: 160 }, params: { modality: 'image' } },
    { id: 'vary-1', type: 'vary', at: { x: 840, y: 160 }, params: { axis: 'look', count: 8 } },
    {
      id: 'compile-1',
      type: 'compile',
      at: { x: 1100, y: 160 },
      params: { target: 'nano-banana-2' },
    },
  ],
  edges: [
    { from: { node: 'reference-1', port: 'out' }, to: { node: 'read-1', port: 'source' } },
    { from: { node: 'reference-2', port: 'out' }, to: { node: 'read-2', port: 'source' } },
    { from: { node: 'read-1', port: 'out' }, to: { node: 'compose-1', port: 'lines' } },
    { from: { node: 'read-2', port: 'out' }, to: { node: 'compose-1', port: 'lines' } },
    { from: { node: 'words-1', port: 'out' }, to: { node: 'compose-1', port: 'words' } },
    { from: { node: 'compose-1', port: 'out' }, to: { node: 'vary-1', port: 'ir' } },
    { from: { node: 'vary-1', port: 'out' }, to: { node: 'compile-1', port: 'ir' } },
  ],
};

export const EXAMPLES: Example[] = [
  { id: 'starter', doc: STARTER, about: 'free' },
  { id: 'bundle', doc: BUNDLE, about: 'about 14c' },
];

export const STARTER_GRAPH = STARTER;
