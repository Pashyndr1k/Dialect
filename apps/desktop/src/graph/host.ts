/**
 * The half of the graph that touches the machine.
 *
 * Core has no filesystem, so two nodes live here instead of in the catalogue:
 * Folder, which scans a directory, and Save, which writes files. The resolver
 * is the same seam — it turns a path into something a reader can look at, and
 * the reader never learns where it came from.
 *
 * Nothing here decides anything either. `readSource` in `App.tsx` did exactly
 * this work, and the calls below are the same ones in the same order.
 */

import {
  BUILTIN_NODES,
  GraphError,
  kindOf,
  mediaTypeOf,
  type GraphSource,
  type NodeSpec,
  type ResolvedSource,
  type Value,
} from '@dialect/core';

import {
  measureAudio,
  probeVideo,
  readFile,
  savePromptsTo,
  scanFolder,
  videoFrames,
} from '../store.ts';

/** Below this the measurement is a guess, and a guess stated as a number is worse than silence. */
const SURE_ENOUGH = 0.5;

/** How many frames stand in for a video. What no single frame shows, five in order do. */
const FRAMES = 5;

/**
 * A path becomes something to look at.
 *
 * Each kind is resolved as what it is: an image is its own bytes, a video is
 * frames taken in order, audio is measured first and its spectrograms looked
 * at second. The measurements travel alongside because they are counted, and a
 * model asked to estimate a tempo from a picture of a waveform will oblige.
 */
export async function resolveSource(source: GraphSource): Promise<ResolvedSource> {
  if (source.kind === 'image') {
    const { base64 } = await readFile(source.path);
    return { parts: [{ mediaType: mediaTypeOf(source.name), base64 }] };
  }

  if (source.kind === 'video') {
    const probe = await probeVideo(source.path);
    const frames = await videoFrames(source.path, FRAMES);
    return {
      parts: frames.map((f) => ({ mediaType: 'image/jpeg', base64: f.base64 })),
      durationS: probe.duration_s,
      aspectRatio: probe.aspect_ratio,
    };
  }

  const m = await measureAudio(source.path);
  return {
    parts: m.pictures.map((p) => ({ mediaType: 'image/jpeg', base64: p.base64 })),
    // Only what was measured confidently. A tempo the detector is unsure of is
    // left out rather than stated, so the reader knows it has to listen.
    measurements: {
      durationS: m.probe.duration_s,
      ...(m.tempo && m.tempo.confidence > SURE_ENOUGH ? { bpm: m.tempo.bpm } : {}),
      ...(m.key && m.key.confidence > SURE_ENOUGH ? { musicalKey: m.key.name } : {}),
      ...(m.lufs !== null ? { lufs: m.lufs } : {}),
      ...(m.lra !== null ? { lra: m.lra } : {}),
      ...(m.probe.title ? { title: m.probe.title } : {}),
      ...(m.probe.artist ? { artist: m.probe.artist } : {}),
      ...(m.probe.genre ? { taggedGenre: m.probe.genre } : {}),
    },
  };
}

const str = (params: Record<string, unknown>, key: string, fallback = ''): string =>
  typeof params[key] === 'string' ? (params[key] as string) : fallback;

const HOST_NODES: NodeSpec[] = [
  {
    /**
     * A folder of references, as one node.
     *
     * Puts every readable file it finds on a single wire, and everything
     * downstream runs once per file without being told there is more than one.
     * That is the whole of what Batch used to be.
     */
    type: 'folder',
    title: 'Folder',
    group: 'in',
    hint: 'Every readable file in a folder, on one wire. This is batch.',
    inputs: {},
    outputs: { out: { type: 'source' } },
    async run(_inputs, params) {
      const dir = str(params, 'dir');
      if (!dir) throw new GraphError('Choose a folder for this node.');

      const found = await scanFolder(dir);
      const usable = found.flatMap((f) => {
        const kind = kindOf(f.name);
        // Unreadable files are skipped rather than failing the run: a folder of
        // photographs with a stray text file in it is still a folder of
        // photographs.
        return kind ? [{ path: f.path, name: f.name, kind }] : [];
      });

      if (usable.length === 0) {
        throw new GraphError(`Nothing readable in ${dir} — no images, videos or audio.`);
      }

      return { out: usable.map((source) => ({ type: 'source' as const, source })) };
    },
  },

  {
    type: 'save',
    title: 'Save',
    group: 'out',
    hint: 'Writes each prompt to a file in a folder you choose.',
    // Whole: writing one file per prompt is one trip to a folder chooser, not
    // twenty. A node that ran per item would ask twenty times.
    inputs: { prompts: { type: 'prompt', whole: true } },
    outputs: {},
    async run(inputs) {
      const list = (Array.isArray(inputs.prompts) ? inputs.prompts : []) as Value[];
      const files = list.flatMap((v, i) => {
        if (v.type !== 'prompt') return [];
        const title = v.prompt.ir.title?.trim() || `prompt-${i + 1}`;
        const safe = title.replace(/[^\w. -]+/g, '-').slice(0, 60);
        return [{ name: `${safe}.txt`, contents: v.prompt.render.text }];
      });

      if (files.length === 0) throw new GraphError('There is nothing to save yet.');
      await savePromptsTo(files);
      return {};
    },
  },
];

/**
 * Every node this build has: the portable ones plus the two that need a disk.
 *
 * Built fresh rather than mutating the core map, so a test that imports the
 * catalogue does not silently gain nodes it cannot run.
 */
export const NODES: Map<string, NodeSpec> = new Map([
  ...BUILTIN_NODES,
  ...HOST_NODES.map((spec) => [spec.type, spec] as const),
]);
