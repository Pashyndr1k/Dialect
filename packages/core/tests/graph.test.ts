import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { composeBundle } from '../src/compose/compose.ts';
import type { ExtractedScene } from '../src/extract/schema.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import { toDocument } from '../src/renderers/document.ts';
import type { PromptIR } from '../src/ir/types.ts';

import { BUILTIN_NODES } from '../src/graph/nodes.ts';
import { runGraph, sinksOf, type NodeOutputs } from '../src/graph/run.ts';
import { canConnect, checkGraph } from '../src/graph/validate.ts';
import {
  CycleError,
  GraphError,
  type GraphDoc,
  type NodeContext,
  type Signal,
} from '../src/graph/types.ts';

const here = (name: string): string => fileURLToPath(new URL(`./golden/${name}`, import.meta.url));
const registry = await loadBuiltinRegistry();

const goldenIR = async (): Promise<PromptIR> =>
  JSON.parse(await readFile(here('cowboy-saloon.ir.json'), 'utf8')) as PromptIR;

/** No node in these graphs opens a file, so the resolver is never reached. */
const noFiles = (): never => {
  throw new Error('This test should not have needed to read a file.');
};

const contextWith = (answers: unknown[] = []): NodeContext => ({
  gateway: new Gateway(new MockProvider(answers), { budgetUsd: 10 }),
  registry,
  resolve: noFiles,
});

const promptFrom = (outputs: Map<string, NodeOutputs>, node: string): ReturnType<typeof compile> => {
  const signal = outputs.get(node)?.out as Signal | undefined;
  const value = signal?.[0];
  if (value?.type !== 'prompt') throw new Error(`"${node}" did not produce a prompt.`);
  return value.prompt;
};

/**
 * The contract this whole migration rests on.
 *
 * The golden test proves a document compiles to one exact prompt. This proves
 * the graph is a way of asking the same question — not a second implementation
 * that happens to agree today. If these two ever diverge, the graph is wrong,
 * because the fixture is a prompt a person wrote before any of this existed.
 */
describe('a graph is the same question, asked on a canvas', () => {
  it('reproduces the hand-written prompt, byte for byte', async () => {
    const ir = await goldenIR();
    const expected = await readFile(here('cowboy-saloon.kling.txt'), 'utf8');

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'src', type: 'document', params: { ir } },
        { id: 'out', type: 'compile', params: { target: 'kling-3-omni' } },
      ],
      edges: [{ from: { node: 'src', port: 'out' }, to: { node: 'out', port: 'ir' } }],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, contextWith());
    const prompt = promptFrom(outputs, 'out');

    expect(toDocument(prompt.render, prompt.profile, { title: ir.title })).toBe(expected);
  });

  it('agrees with a direct compile on findings as well as text', async () => {
    const ir = await goldenIR();
    const direct = compile(ir, getProfile(registry, 'kling-3-omni'));

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'src', type: 'document', params: { ir } },
        { id: 'out', type: 'compile', params: { target: 'kling-3-omni' } },
      ],
      edges: [{ from: { node: 'src', port: 'out' }, to: { node: 'out', port: 'ir' } }],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, contextWith());
    const viaGraph = promptFrom(outputs, 'out');

    expect(viaGraph.render.text).toBe(direct.render.text);
    expect(viaGraph.render.negative).toBe(direct.render.negative);
    expect(viaGraph.findings).toEqual(direct.findings);
    expect(viaGraph.blocked).toBe(direct.blocked);
  });

  it('composes through a graph exactly as the direct call does', async () => {
    const SCENE: ExtractedScene = {
      headline: 'a cowboy at a saloon bar',
      entities: [{ name: 'the cowboy', type: 'person', description: 'silver stubble' }],
      action: 'leans on the bar',
      location: 'a frontier saloon',
      locationDescription: 'a long scratched counter',
      timeOfDay: 'night',
      era: '1880s',
      shotSize: 'medium',
      angle: 'eye level',
      aspectRatio: '4:5',
      lightingKey: 'a single oil lantern',
      lightingSources: [],
      contrast: 'high',
      colorTemp: 'warm',
      opticsEffect: 'the room falls into soft blur',
      palette: ['#2B1D12'],
      grade: 'warm, muted',
      grain: 'fine-uniform',
      medium: 'film still',
      genre: 'western',
      atmosphere: 'dust in the lantern light',
      textInImage: [],
    };

    const bundle = {
      modality: 'image' as const,
      items: [
        { id: 'words', kind: 'words' as const, role: 'auto' as const, lines: ['a cowboy, at night'] },
        {
          id: 'look.png',
          kind: 'image' as const,
          role: 'style' as const,
          lines: ['Grade: warm, muted', 'Light: one lantern'],
        },
      ],
    };

    // Two gateways, two identical scripts: the same question asked twice, with
    // nothing shared between them that could make them agree by accident.
    const direct = await composeBundle(
      new Gateway(new MockProvider([SCENE]), { budgetUsd: 10 }),
      bundle,
    );

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'words', type: 'words', params: { text: 'a cowboy, at night' } },
        {
          id: 'look',
          type: 'kept',
          params: {
            id: 'look.png',
            kind: 'image',
            role: 'style',
            lines: ['Grade: warm, muted', 'Light: one lantern'],
          },
        },
        { id: 'mix', type: 'compose', params: { modality: 'image' } },
      ],
      edges: [
        { from: { node: 'words', port: 'out' }, to: { node: 'mix', port: 'words' } },
        { from: { node: 'look', port: 'out' }, to: { node: 'mix', port: 'lines' } },
      ],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, contextWith([SCENE]));
    const composed = (outputs.get('mix')?.out as Signal)[0];
    if (composed?.type !== 'ir') throw new Error('Compose did not produce a document.');
    expect(composed.ir).toEqual(direct.ir);
  });
});

describe('one wire, many things', () => {
  it('runs everything downstream once per item, without the nodes knowing', async () => {
    const ir = await goldenIR();

    // Three documents on one wire is what a folder of three references looks
    // like from Compile's side — which is the whole of batch processing.
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'a', type: 'document', params: { ir } },
        { id: 'b', type: 'document', params: { ir: { ...ir, title: 'second' } } },
        { id: 'c', type: 'document', params: { ir: { ...ir, title: 'third' } } },
        { id: 'out', type: 'compile', params: { target: 'kling-3-omni' } },
      ],
      edges: [
        { from: { node: 'a', port: 'out' }, to: { node: 'out', port: 'ir' } },
        { from: { node: 'b', port: 'out' }, to: { node: 'out', port: 'ir' } },
        { from: { node: 'c', port: 'out' }, to: { node: 'out', port: 'ir' } },
      ],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, contextWith());
    expect((outputs.get('out')?.out as Signal).length).toBe(3);
  });

  it('sends one document to two models in a single run', async () => {
    const ir = await goldenIR();
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'src', type: 'document', params: { ir } },
        { id: 'kling', type: 'compile', params: { target: 'kling-3-omni' } },
        { id: 'seedance', type: 'compile', params: { target: 'seedance-2.5' } },
      ],
      edges: [
        { from: { node: 'src', port: 'out' }, to: { node: 'kling', port: 'ir' } },
        { from: { node: 'src', port: 'out' }, to: { node: 'seedance', port: 'ir' } },
      ],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, contextWith());
    const kling = promptFrom(outputs, 'kling');
    const seedance = promptFrom(outputs, 'seedance');

    expect(kling.render.text).not.toBe(seedance.render.text);
    expect(kling.render.text).toContain('50mm lens');
    expect(seedance.render.text).not.toContain('50mm');
  });
});

describe('not running what has not changed', () => {
  it('skips a node whose question is the same as last time', async () => {
    const ir = await goldenIR();
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'src', type: 'document', params: { ir } },
        { id: 'out', type: 'compile', params: { target: 'kling-3-omni' } },
      ],
      edges: [{ from: { node: 'src', port: 'out' }, to: { node: 'out', port: 'ir' } }],
    };

    const memo = new Map<string, NodeOutputs>();
    const first = await runGraph(doc, BUILTIN_NODES, contextWith(), { memo });
    const second = await runGraph(doc, BUILTIN_NODES, contextWith(), { memo });

    expect(first.ran).toEqual(['src', 'out']);
    expect(second.ran).toEqual([]);
    expect(second.cached).toEqual(['src', 'out']);
    // And the answer survives the skip, rather than the run quietly emptying.
    expect(promptFrom(second.outputs, 'out').render.text).toBe(
      promptFrom(first.outputs, 'out').render.text,
    );
  });

  it('re-runs what is downstream of an edit, and only that', async () => {
    const ir = await goldenIR();
    const graph = (target: string): GraphDoc => ({
      version: 1,
      nodes: [
        { id: 'src', type: 'document', params: { ir } },
        { id: 'out', type: 'compile', params: { target } },
      ],
      edges: [{ from: { node: 'src', port: 'out' }, to: { node: 'out', port: 'ir' } }],
    });

    const memo = new Map<string, NodeOutputs>();
    await runGraph(graph('kling-3-omni'), BUILTIN_NODES, contextWith(), { memo });
    const second = await runGraph(graph('seedance-2.5'), BUILTIN_NODES, contextWith(), { memo });

    // The document did not change, so it is not read again; the target did.
    expect(second.cached).toEqual(['src']);
    expect(second.ran).toEqual(['out']);
  });
});

describe('a graph that cannot run says so before it spends', () => {
  it('refuses a reading plugged into a document socket', () => {
    expect(canConnect('lines', 'ir')).toBe(false);
    expect(canConnect('ir', 'ir')).toBe(true);
  });

  it('names both ends when a wire could not carry anything', () => {
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'w', type: 'words', params: { text: 'hello' } },
        { id: 'out', type: 'compile', params: { target: 'kling-3-omni' } },
      ],
      edges: [{ from: { node: 'w', port: 'out' }, to: { node: 'out', port: 'ir' } }],
    };

    const problems = checkGraph(doc, BUILTIN_NODES);
    // The port's label, which the glossary makes 'user prompt' — the refusal
    // has to name what a person sees on the socket, not the type's id.
    expect(problems.some((p) => p.fatal && p.message.includes('user prompt'))).toBe(true);
  });

  it('reports a required socket with nothing on it', () => {
    const doc: GraphDoc = {
      version: 1,
      nodes: [{ id: 'out', type: 'compile', params: { target: 'kling-3-omni' } }],
      edges: [],
    };

    const problems = checkGraph(doc, BUILTIN_NODES);
    expect(problems.some((p) => p.message.includes('Compile'))).toBe(true);
  });

  it('names the circle rather than the node that noticed it', async () => {
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'a', type: 'fields' },
        { id: 'b', type: 'fields' },
      ],
      edges: [
        { from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'ir' } },
        { from: { node: 'b', port: 'out' }, to: { node: 'a', port: 'ir' } },
      ],
    };

    await expect(runGraph(doc, BUILTIN_NODES, contextWith())).rejects.toBeInstanceOf(CycleError);
  });

  it('says which node failed, not which function', async () => {
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'src', type: 'document', params: { ir: await goldenIR() } },
        { id: 'out', type: 'compile', params: { target: 'no-such-model' } },
      ],
      edges: [{ from: { node: 'src', port: 'out' }, to: { node: 'out', port: 'ir' } }],
    };

    await expect(runGraph(doc, BUILTIN_NODES, contextWith())).rejects.toThrow(/Compile/);
  });

  it('does not run a node nothing asked for', async () => {
    const ir = await goldenIR();
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'src', type: 'document', params: { ir } },
        { id: 'wanted', type: 'compile', params: { target: 'kling-3-omni' } },
        // Reads nothing and is read by nothing. A sink, so a default run would
        // reach it — but not when the run is told what it is for.
        { id: 'idle', type: 'words', params: { text: '' } },
      ],
      edges: [{ from: { node: 'src', port: 'out' }, to: { node: 'wanted', port: 'ir' } }],
    };

    expect(sinksOf(doc).sort()).toEqual(['idle', 'wanted']);
    const { ran } = await runGraph(doc, BUILTIN_NODES, contextWith(), { want: ['wanted'] });
    expect(ran).toEqual(['src', 'wanted']);
  });

  it('refuses two fanned-out wires of different lengths, by name', async () => {
    const ir = await goldenIR();
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'w1', type: 'words', params: { text: 'one' } },
        { id: 'w2', type: 'words', params: { text: 'two' } },
        { id: 't1', type: 'document', params: { ir } },
        { id: 't2', type: 'document', params: { ir } },
        { id: 't3', type: 'document', params: { ir } },
        { id: 'edit', type: 'fields' },
      ],
      edges: [
        { from: { node: 't1', port: 'out' }, to: { node: 'edit', port: 'ir' } },
        { from: { node: 't2', port: 'out' }, to: { node: 'edit', port: 'ir' } },
        { from: { node: 't3', port: 'out' }, to: { node: 'edit', port: 'ir' } },
        { from: { node: 'w1', port: 'out' }, to: { node: 'edit', port: 'ir' } },
        { from: { node: 'w2', port: 'out' }, to: { node: 'edit', port: 'ir' } },
      ],
    };

    // Three documents and two sets of words on one socket: there is no sensible
    // pairing, so it is refused rather than truncated to the shorter.
    await expect(runGraph(doc, BUILTIN_NODES, contextWith())).rejects.toBeInstanceOf(GraphError);
  });
});
