import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.ts';
import { composeBundle } from '../src/compose/compose.ts';
import { sceneLines } from '../src/compose/lines.ts';
import { expandIdea, fillTemplate } from '../src/extract/idea.ts';
import { extractFromImages } from '../src/extract/image.ts';
import type { ExtractedScene } from '../src/extract/schema.ts';
import { expandShot } from '../src/sequence/expand.ts';
import { SEQUENCE_VERSION, type Sequence, type SequenceShot } from '../src/sequence/types.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { getProfile } from '../src/registry/load.ts';
import { loadBuiltinRegistry } from '../src/registry/load-node.ts';
import { loadBuiltinLibrary } from '../src/templates/load-node.ts';
import { learnTemplate } from '../src/templates/learn.ts';
import { applyVariant, vary } from '../src/vary/vary.ts';
import type { BundleItem } from '../src/compose/types.ts';
import type { PromptIR } from '../src/ir/types.ts';

import { BUILTIN_NODES } from '../src/graph/nodes.ts';
import { runGraph } from '../src/graph/run.ts';
import type { GraphDoc, NodeContext, ResolvedSource, Signal } from '../src/graph/types.ts';

/**
 * Ф2: proof that the interface moved and the substance did not.
 *
 * Every pipeline the app can run today, written twice — once as the direct
 * calls `App.tsx` makes, once as a graph — and asserted to produce the same
 * document. Two gateways, two providers, one script each: nothing is shared
 * between the halves that could make them agree by accident.
 *
 * These are the pairs. When one fails, the graph is wrong, because the direct
 * half is what has been shipping for thirty-one versions.
 */

const registry = await loadBuiltinRegistry();
const library = await loadBuiltinLibrary();
const here = (name: string): string => fileURLToPath(new URL(`./golden/${name}`, import.meta.url));

const goldenIR = async (): Promise<PromptIR> =>
  JSON.parse(await readFile(here('cowboy-saloon.ir.json'), 'utf8')) as PromptIR;

const PART = { mediaType: 'image/png', base64: 'a-reference' };

const SCENE: ExtractedScene = {
  headline: 'a cowboy at a saloon bar',
  entities: [{ name: 'the cowboy', type: 'person', description: 'silver stubble, a scarred lip' }],
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

/**
 * The host's job, stubbed: a file has already become something to look at.
 *
 * The bytes are derived from the name, because three different files are three
 * different pictures. Handing back identical bytes would be one question asked
 * three times, and the gateway would rightly answer it once — which looks like
 * a broken fan-out and is not.
 */
const resolve = async (source: { name: string }): Promise<ResolvedSource> => ({
  parts: [{ mediaType: 'image/png', base64: `bytes-of-${source.name}` }],
});

const freshGateway = (answers: unknown[]): Gateway =>
  new Gateway(new MockProvider(answers), { budgetUsd: 10 });

const context = (answers: unknown[]): NodeContext => ({
  gateway: freshGateway(answers),
  registry,
  library,
  resolve,
});

/** Pull one document off a node's output port. */
const irFrom = (
  outputs: Map<string, Record<string, Signal>>,
  node: string,
  port = 'out',
): PromptIR => {
  const value = outputs.get(node)?.[port]?.[0];
  if (value?.type !== 'ir') throw new Error(`"${node}.${port}" did not produce a document.`);
  return value.ir;
};

const allIRs = (outputs: Map<string, Record<string, Signal>>, node: string): PromptIR[] =>
  (outputs.get(node)?.out ?? []).map((v) => {
    if (v.type !== 'ir') throw new Error(`"${node}" produced a ${v.type}, not a document.`);
    return v.ir;
  });

describe('one reference, nothing typed', () => {
  /**
   * The app's pass-through: a lone reference that was just read already has a
   * document, so it is used as it is. Getting this wrong is not a wrong answer
   * — it is a compose call nobody asked for, bought every time.
   */
  it('uses the reading itself, without paying to compose a bundle of one', async () => {
    const direct = await extractFromImages(freshGateway([SCENE]), [PART], {
      reference: 'ref.png',
    });

    const provider = new MockProvider([SCENE]);
    const ctx: NodeContext = {
      gateway: new Gateway(provider, { budgetUsd: 10 }),
      registry,
      library,
      resolve,
    };

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'ref', type: 'reference', params: { path: '/x/ref.png', kind: 'image' } },
        { id: 'read', type: 'read' },
        { id: 'out', type: 'compile', params: { target: 'nano-banana-2' } },
      ],
      edges: [
        { from: { node: 'ref', port: 'out' }, to: { node: 'read', port: 'source' } },
        // The document port, not the lines port. This is the whole point.
        { from: { node: 'read', port: 'ir' }, to: { node: 'out', port: 'ir' } },
      ],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, ctx);
    expect(irFrom(outputs, 'read', 'ir')).toEqual(direct.ir);
    // One call: the read. Composing would have been a second.
    expect(provider.calls).toHaveLength(1);
  });
});

describe('words, and nothing else', () => {
  it('expands an idea the same way', async () => {
    const idea = 'a lighthouse keeper at the end of a long winter';
    const direct = await expandIdea(freshGateway([SCENE]), idea, { modality: 'image' });

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'w', type: 'words', params: { text: idea } },
        { id: 'idea', type: 'idea', params: { modality: 'image' } },
      ],
      edges: [{ from: { node: 'w', port: 'out' }, to: { node: 'idea', port: 'words' } }],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, context([SCENE]));
    expect(irFrom(outputs, 'idea')).toEqual(direct.ir);
  });
});

describe('words and a reference together', () => {
  it('builds the same bundle, in the same order, with the same jobs', async () => {
    const note = 'make it colder, and at dawn';
    const reading = await extractFromImages(freshGateway([SCENE]), [PART], {
      reference: 'look.png',
    });

    const items: BundleItem[] = [
      { id: 'words', kind: 'words', role: 'auto', lines: [note] },
      { id: 'look.png', kind: 'image', role: 'style', lines: sceneLines(reading.scene) },
    ];
    const direct = await composeBundle(freshGateway([SCENE]), {
      items,
      modality: 'image',
    });

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'w', type: 'words', params: { text: note } },
        { id: 'ref', type: 'reference', params: { path: '/x/look.png', kind: 'image' } },
        { id: 'read', type: 'read', params: { role: 'style' } },
        { id: 'mix', type: 'compose', params: { modality: 'image' } },
      ],
      edges: [
        { from: { node: 'ref', port: 'out' }, to: { node: 'read', port: 'source' } },
        { from: { node: 'read', port: 'out' }, to: { node: 'mix', port: 'lines' } },
        { from: { node: 'w', port: 'out' }, to: { node: 'mix', port: 'words' } },
      ],
    };

    // Two answers: the read, then the compose.
    const { outputs } = await runGraph(doc, BUILTIN_NODES, context([SCENE, SCENE]));
    expect(irFrom(outputs, 'mix')).toEqual(direct.ir);
  });

  it('keeps a style source lending nothing of its subject', async () => {
    // The claim the roles rest on. Asserted here rather than trusted, because
    // the role travels through three hops on a graph and one dropped field
    // would make every style reference behave like a subject one.
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'w', type: 'words', params: { text: 'a cowboy at a bar' } },
        { id: 'ref', type: 'reference', params: { path: '/x/snow.png', kind: 'image' } },
        { id: 'read', type: 'read' },
        { id: 'job', type: 'role', params: { role: 'style' } },
        { id: 'mix', type: 'compose', params: { modality: 'image' } },
      ],
      edges: [
        { from: { node: 'ref', port: 'out' }, to: { node: 'read', port: 'source' } },
        { from: { node: 'read', port: 'out' }, to: { node: 'job', port: 'lines' } },
        { from: { node: 'job', port: 'out' }, to: { node: 'mix', port: 'lines' } },
        { from: { node: 'w', port: 'out' }, to: { node: 'mix', port: 'words' } },
      ],
    };

    const provider = new MockProvider([SCENE, SCENE]);
    await runGraph(doc, BUILTIN_NODES, {
      gateway: new Gateway(provider, { budgetUsd: 10 }),
      registry,
      library,
      resolve,
    });

    // The job travels in the instruction, beside the source it belongs to; the
    // brief that says what a job may decide is in the system prompt. A role
    // that survived the graph shows up in the first, not the second.
    const composeCall = provider.calls[1]!;
    expect(composeCall.instruction).toContain('snow.png');
    expect(composeCall.instruction).toContain('job: style');
    expect(composeCall.system).toContain('Nothing about what is in it');
  });
});

describe('a template', () => {
  const id = [...library.templates.keys()][0]!;

  /**
   * What the model is asked to fill in, taken from the template itself rather
   * than written down here. A template is data and its questions can change;
   * a test that hardcoded them would fail for the wrong reason.
   */
  const answersFor = (templateId: string): Record<string, string> =>
    Object.fromEntries(
      (library.templates.get(templateId)?.variables ?? []).map((v) => [
        v.name,
        v.default ?? `some ${v.name}`,
      ]),
    );

  it('fills from words alone the same way', async () => {
    const idea = 'a dwarven smith, iron rings in his beard';

    const script = [answersFor(id)];
    const direct = await fillTemplate(freshGateway(script), idea, library, id);

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'w', type: 'words', params: { text: idea } },
        { id: 't', type: 'template', params: { id } },
        { id: 'fill', type: 'fill' },
      ],
      edges: [
        { from: { node: 'w', port: 'out' }, to: { node: 'fill', port: 'words' } },
        { from: { node: 't', port: 'out' }, to: { node: 'fill', port: 'template' } },
      ],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, context(script));
    expect(irFrom(outputs, 'fill')).toEqual(direct.ir);
  });

  it('fills through a bundle when there is a reference in hand', async () => {
    // The app's other template path: with sources attached it goes through
    // compose, so the template's own decisions stay decided and the composer
    // never sees its document. Two calls that look alike and are not.
    const script = [answersFor(id)];

    const direct = await composeBundle(
      freshGateway(script),
      {
        items: [{ id: 'words', kind: 'words', role: 'auto', lines: ['a dwarven smith'] }],
        modality: 'image',
      },
      { templateId: id, library },
    );

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'w', type: 'words', params: { text: 'a dwarven smith' } },
        { id: 'k', type: 'kept', params: { id: 'words', kind: 'words', lines: ['a dwarven smith'] } },
        { id: 'mix', type: 'compose', params: { modality: 'image', templateId: id } },
      ],
      edges: [{ from: { node: 'k', port: 'out' }, to: { node: 'mix', port: 'lines' } }],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, context(script));
    expect(irFrom(outputs, 'mix')).toEqual(direct.ir);
  });
});

describe('variations', () => {
  it('produces the same set, from one call rather than eight', async () => {
    const ir = await goldenIR();
    const variants = Array.from({ length: 4 }, (_, i) => ({
      label: `Smith ${i + 1}`,
      headline: `an elven bowyer, number ${i + 1}`,
      description: `wiry, a burn scar, number ${i + 1}`,
      action: 'draws a stave across the bench',
    }));

    const script = [{ variants }];
    const direct = await vary(freshGateway(script), ir, { axis: 'subject', count: 4 });
    const expected = direct.variants.map((v) => applyVariant(ir, 'subject', v));

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'src', type: 'document', params: { ir } },
        { id: 'v', type: 'vary', params: { axis: 'subject', count: 4 } },
      ],
      edges: [{ from: { node: 'src', port: 'out' }, to: { node: 'v', port: 'ir' } }],
    };

    const provider = new MockProvider(script);
    const { outputs } = await runGraph(doc, BUILTIN_NODES, {
      gateway: new Gateway(provider, { budgetUsd: 10 }),
      registry,
      library,
      resolve,
    });

    expect(allIRs(outputs, 'v')).toEqual(expected);
    expect(provider.calls).toHaveLength(1);
  });

  it('compiles every variant, because the wire carries all four', async () => {
    const ir = await goldenIR();
    const variants = Array.from({ length: 4 }, (_, i) => ({
      label: `Smith ${i + 1}`,
      headline: `an elven bowyer, number ${i + 1}`,
      description: `wiry, number ${i + 1}`,
      action: 'draws a stave',
    }));

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'src', type: 'document', params: { ir } },
        { id: 'v', type: 'vary', params: { axis: 'subject', count: 4 } },
        { id: 'out', type: 'compile', params: { target: 'kling-3-omni' } },
      ],
      edges: [
        { from: { node: 'src', port: 'out' }, to: { node: 'v', port: 'ir' } },
        { from: { node: 'v', port: 'out' }, to: { node: 'out', port: 'ir' } },
      ],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, context([{ variants }]));
    const prompts = outputs.get('out')?.out ?? [];
    expect(prompts).toHaveLength(4);

    const texts = prompts.map((p) => (p.type === 'prompt' ? p.prompt.render.text : ''));
    expect(new Set(texts).size).toBe(4);
  });
});

describe('a sequence', () => {
  it('expands shots against one world, the same as the direct call', async () => {
    const ir = await goldenIR();
    const shots: SequenceShot[] = [
      { id: 'a', action: 'he sets the glass down' },
      { id: 'b', action: 'he looks up', seam: 'hard-cut' },
    ];

    const sequence: Sequence = { seqVersion: SEQUENCE_VERSION, world: ir, shots };
    const expected = shots.map((_, i) => expandShot(sequence, i));

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'src', type: 'document', params: { ir } },
        { id: 'seq', type: 'sequence', params: { shots } },
      ],
      edges: [{ from: { node: 'src', port: 'out' }, to: { node: 'seq', port: 'ir' } }],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, context([]));
    expect(allIRs(outputs, 'seq')).toEqual(expected);
  });
});

describe('a folder of references', () => {
  it('runs the whole chain once per file, with no batch machinery involved', async () => {
    // What Batch.tsx does today, as an edge carrying three things. Nothing
    // downstream is told there is more than one.
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'a', type: 'reference', params: { path: '/x/one.png', kind: 'image' } },
        { id: 'b', type: 'reference', params: { path: '/x/two.png', kind: 'image' } },
        { id: 'c', type: 'reference', params: { path: '/x/three.png', kind: 'image' } },
        { id: 'read', type: 'read' },
        { id: 'out', type: 'compile', params: { target: 'nano-banana-2' } },
      ],
      edges: [
        { from: { node: 'a', port: 'out' }, to: { node: 'read', port: 'source' } },
        { from: { node: 'b', port: 'out' }, to: { node: 'read', port: 'source' } },
        { from: { node: 'c', port: 'out' }, to: { node: 'read', port: 'source' } },
        { from: { node: 'read', port: 'ir' }, to: { node: 'out', port: 'ir' } },
      ],
    };

    const provider = new MockProvider([SCENE, SCENE, SCENE]);
    const { outputs } = await runGraph(doc, BUILTIN_NODES, {
      gateway: new Gateway(provider, { budgetUsd: 10 }),
      registry,
      library,
      resolve,
    });

    expect(outputs.get('out')?.out).toHaveLength(3);
    expect(provider.calls).toHaveLength(3);
  });

  it('stops at the budget instead of reading the rest of the folder', async () => {
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'a', type: 'reference', params: { path: '/x/one.png', kind: 'image' } },
        { id: 'b', type: 'reference', params: { path: '/x/two.png', kind: 'image' } },
        { id: 'c', type: 'reference', params: { path: '/x/three.png', kind: 'image' } },
        { id: 'read', type: 'read' },
      ],
      edges: [
        { from: { node: 'a', port: 'out' }, to: { node: 'read', port: 'source' } },
        { from: { node: 'b', port: 'out' }, to: { node: 'read', port: 'source' } },
        { from: { node: 'c', port: 'out' }, to: { node: 'read', port: 'source' } },
      ],
    };

    // Two files' worth of budget, three files. The cap is the gateway's, so it
    // holds on a graph exactly as it holds anywhere else.
    const provider = new MockProvider([SCENE, SCENE, SCENE], { costPerCall: 0.05 });
    await expect(
      runGraph(doc, BUILTIN_NODES, {
        gateway: new Gateway(provider, { budgetUsd: 0.1 }),
        registry,
        library,
        resolve,
      }),
    ).rejects.toThrow();

    expect(provider.calls.length).toBeLessThan(3);
  });
});

describe('retargeting', () => {
  it('renders every model from one document, spending nothing extra', async () => {
    const ir = await goldenIR();
    const targets = ['kling-3-omni', 'seedance-2.5', 'nano-banana-2'];

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'src', type: 'document', params: { ir } },
        ...targets.map((t) => ({ id: t, type: 'compile', params: { target: t } })),
      ],
      edges: targets.map((t) => ({
        from: { node: 'src', port: 'out' },
        to: { node: t, port: 'ir' },
      })),
    };

    const provider = new MockProvider([]);
    const { outputs } = await runGraph(doc, BUILTIN_NODES, {
      gateway: new Gateway(provider, { budgetUsd: 10 }),
      registry,
      library,
      resolve,
    });

    for (const t of targets) {
      const direct = compile(ir, getProfile(registry, t));
      const value = outputs.get(t)?.out?.[0];
      if (value?.type !== 'prompt') throw new Error(`${t} produced no prompt.`);
      expect(value.prompt.render.text).toBe(direct.render.text);
    }
    // Rendering is free. Three dialects, no calls.
    expect(provider.calls).toHaveLength(0);
  });
});

describe('the kinds a reference can be', () => {
  /**
   * The clip and the track paths carry facts the still path does not: a probe's
   * duration and aspect, and a track's measured tempo, key and loudness. Those
   * travel from the host through the resolver, and a graph that dropped them
   * would still produce a document — a worse one, with the numbers guessed.
   */
  const SHOT = {
    ...SCENE,
    aspectRatio: '16:9',
    cameraMove: 'push-in',
    cameraSpeed: 'slow',
    subjectMotion: 'raises a shot glass without drinking from it',
    beats: [{ t: '00:00', action: 'he rests both forearms on the bar' }],
  };

  const SONG = {
    genre: 'dusty americana',
    instruments: ['brushed drums', 'upright bass', 'lap steel'],
    vocals: 'present' as const,
    vocalDescription: 'a low male voice, close and dry',
    structure: ['intro', 'verse', 'chorus'],
    mood: 'world-weary and unhurried',
    mix: 'warm and dark, gently compressed',
    uncertain: [],
  };

  it('tells a clip reader what the probe measured', async () => {
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'ref', type: 'reference', params: { path: '/x/clip.mp4', kind: 'video' } },
        { id: 'read', type: 'read' },
      ],
      edges: [{ from: { node: 'ref', port: 'out' }, to: { node: 'read', port: 'source' } }],
    };

    const provider = new MockProvider([SHOT]);
    await runGraph(doc, BUILTIN_NODES, {
      gateway: new Gateway(provider, { budgetUsd: 10 }),
      registry,
      library,
      resolve: async () => ({
        parts: [{ mediaType: 'image/jpeg', base64: 'frame' }],
        durationS: 8.5,
        aspectRatio: '16:9',
      }),
    });

    const asked = provider.calls[0]?.instruction ?? '';
    expect(asked).toContain('8.5 seconds');
  });

  it('puts the shape of a clip into the document rather than into the question', async () => {
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'ref', type: 'reference', params: { path: '/x/clip.mp4', kind: 'video' } },
        { id: 'read', type: 'read' },
      ],
      edges: [{ from: { node: 'ref', port: 'out' }, to: { node: 'read', port: 'source' } }],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, {
      gateway: new Gateway(new MockProvider([SHOT]), { budgetUsd: 10 }),
      registry,
      library,
      resolve: async () => ({
        parts: [{ mediaType: 'image/jpeg', base64: 'frame' }],
        durationS: 8.5,
        aspectRatio: '16:9',
      }),
    });

    const ir = irFrom(outputs, 'read', 'ir');
    expect(ir.shot?.aspectRatio).toBe('16:9');
    expect(ir.shot?.durationS).toBe(8.5);
  });

  it('tells a track reader what was counted rather than letting it guess', async () => {
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'ref', type: 'reference', params: { path: '/x/song.mp3', kind: 'audio' } },
        { id: 'read', type: 'read' },
      ],
      edges: [{ from: { node: 'ref', port: 'out' }, to: { node: 'read', port: 'source' } }],
    };

    const provider = new MockProvider([SONG]);
    await runGraph(doc, BUILTIN_NODES, {
      gateway: new Gateway(provider, { budgetUsd: 10 }),
      registry,
      library,
      resolve: async () => ({
        parts: [{ mediaType: 'image/jpeg', base64: 'spectrogram' }],
        measurements: { durationS: 194.3, bpm: 78.4, musicalKey: 'A minor', lufs: -12.6 },
      }),
    });

    const asked = provider.calls[0]?.instruction ?? '';
    expect(asked).toContain('78 BPM');
    expect(asked).toContain('A minor');
  });

  it('names the track in provenance, which is the node filling in what the host left out', async () => {
    // The resolver hands over measurements without a reference: the host knows
    // the bytes, the node knows which source they came from. If the node did
    // not fill it in, provenance would say nothing and an untitled track would
    // stay untitled.
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'ref', type: 'reference', params: { path: '/x/song.mp3', kind: 'audio' } },
        { id: 'read', type: 'read' },
      ],
      edges: [{ from: { node: 'ref', port: 'out' }, to: { node: 'read', port: 'source' } }],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, {
      gateway: new Gateway(new MockProvider([SONG]), { budgetUsd: 10 }),
      registry,
      library,
      resolve: async () => ({
        parts: [{ mediaType: 'image/jpeg', base64: 'spectrogram' }],
        measurements: { durationS: 194.3, bpm: 78.4 },
      }),
    });

    const ir = irFrom(outputs, 'read', 'ir');
    expect(ir.provenance?.[0]?.ref).toBe('song.mp3');
    expect(ir.title).toBe('song.mp3');
  });

  it('refuses a track that was never measured, instead of describing a picture of it', async () => {
    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'ref', type: 'reference', params: { path: '/x/song.mp3', kind: 'audio' } },
        { id: 'read', type: 'read' },
      ],
      edges: [{ from: { node: 'ref', port: 'out' }, to: { node: 'read', port: 'source' } }],
    };

    await expect(
      runGraph(doc, BUILTIN_NODES, {
        gateway: new Gateway(new MockProvider([SONG]), { budgetUsd: 10 }),
        registry,
        library,
        resolve: async () => ({ parts: [{ mediaType: 'image/jpeg', base64: 'x' }] }),
      }),
    ).rejects.toThrow(/measured/);
  });
});

describe('learning a template from a prompt that already works', () => {
  it('produces the same template as the direct call', async () => {
    const example =
      'full-body character concept for a dark fantasy RPG, a grizzled dwarven smith, ' +
      'broad and low-slung, beard braided with iron rings, hand-painted, plain background';

    const LEARNED = {
      name: 'RPG character sheet',
      description: 'A full-body character concept, hand-painted, on a plain background.',
      variables: [
        {
          name: 'character',
          label: 'Who they are',
          hint: 'Build, face, wear.',
          default: 'a grizzled dwarven smith, broad and low-slung',
        },
      ],
      headline: 'full-body character concept for a dark fantasy RPG',
      entities: [{ name: '{{character}}', type: 'person', description: '{{character}}' }],
      action: '',
      location: '',
      locationDescription: '',
      timeOfDay: '',
      era: '',
      shotSize: 'full',
      angle: 'eye level',
      aspectRatio: '2:3',
      lightingKey: 'even studio light',
      lightingSources: [],
      contrast: 'medium',
      colorTemp: 'neutral',
      opticsEffect: '',
      palette: [],
      grade: 'hand-painted',
      grain: '',
      medium: 'digital painting',
      genre: 'dark fantasy',
      atmosphere: '',
      textInImage: [],
      avoid: ['extra fingers', 'watermarks'],
    };

    const direct = await learnTemplate(freshGateway([LEARNED]), example, {
      kind: 'text2img',
      cast: 1,
      writtenFor: 'nano-banana-2',
    });

    const doc: GraphDoc = {
      version: 1,
      nodes: [
        { id: 'w', type: 'words', params: { text: example } },
        {
          id: 'learn',
          type: 'learn',
          params: { kind: 'text2img', cast: 1, writtenFor: 'nano-banana-2' },
        },
      ],
      edges: [{ from: { node: 'w', port: 'out' }, to: { node: 'learn', port: 'words' } }],
    };

    const { outputs } = await runGraph(doc, BUILTIN_NODES, context([LEARNED]));
    const value = outputs.get('learn')?.out?.[0];
    if (value?.type !== 'template') throw new Error('Learn produced no template.');

    expect(value.template).toEqual(direct.template);
    // The model an example was written for is part of what the template is.
    expect(value.template.target).toBe('nano-banana-2');
  });
});
