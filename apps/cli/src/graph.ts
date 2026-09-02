/**
 * Running a saved graph from a terminal.
 *
 * The window and this share one runner and one node catalogue; what differs is
 * who opens the files. Core cannot — it has no filesystem by design — so each
 * front end hands in a resolver, and this is the one made of ffmpeg and
 * `node:fs` rather than of Rust.
 *
 * Which is the whole point of the exercise: a graph built by dragging can then
 * be pointed at five hundred files and left overnight, and it is the same graph
 * producing the same prompts.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join, extname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import {
  BUILTIN_NODES,
  GraphError,
  kindOf,
  mediaTypeOf,
  promptFileName,
  runGraph,
  type GraphDoc,
  type GraphSource,
  type NodeSpec,
  type ResolvedSource,
  type Signal,
} from '@dialect/core';

const run = promisify(execFile);

/** How many frames stand in for a clip. Matches the window exactly. */
const FRAMES = 5;

async function has(tool: string): Promise<boolean> {
  try {
    await run(tool, ['-version'], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

interface Probe {
  durationS: number;
  aspectRatio: string;
}

/** What ffprobe knows about a clip, in the shape the reader wants. */
async function probe(path: string): Promise<Probe> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration',
    '-show_entries', 'format=duration',
    '-of', 'json',
    path,
  ]);

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number; duration?: string }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0] ?? {};
  const durationS = Number(stream.duration ?? parsed.format?.duration ?? 0);

  // The ratio people would write, not the raw fraction.
  const w = stream.width ?? 0;
  const h = stream.height ?? 0;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = w && h ? gcd(w, h) : 0;

  return { durationS, aspectRatio: g ? `${w / g}:${h / g}` : '' };
}

/**
 * Frames taken in order, spread across the clip without touching its edges.
 *
 * The first and last moments of a clip are usually a fade or a slate, and a
 * reader shown those describes the fade.
 */
async function frames(path: string, durationS: number): Promise<string[]> {
  const dir = join(tmpdir(), `dialect-frames-${process.pid}-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  const out: string[] = [];
  for (let i = 0; i < FRAMES; i += 1) {
    const at = (durationS * (i + 1)) / (FRAMES + 1);
    const file = join(dir, `${i}.jpg`);
    await run('ffmpeg', ['-ss', at.toFixed(3), '-i', path, '-frames:v', '1', '-q:v', '3', '-y', file]);
    out.push((await readFile(file)).toString('base64'));
  }
  return out;
}

/**
 * A path becomes something to look at.
 *
 * Stills need nothing but the disk. Clips need ffmpeg. Tracks are refused, and
 * that is said plainly rather than half-done: measuring a track means counting
 * its tempo, key and loudness before anything is described, and that lives in
 * the desktop host. A guessed tempo stated as a fact is worse than no tempo.
 */
export function resolverFor(tools: { ffmpeg: boolean; ffprobe: boolean }) {
  return async (source: GraphSource): Promise<ResolvedSource> => {
    if (source.kind === 'image') {
      const base64 = (await readFile(source.path)).toString('base64');
      return { parts: [{ mediaType: mediaTypeOf(source.name), base64 }] };
    }

    if (source.kind === 'video') {
      if (!tools.ffmpeg || !tools.ffprobe) {
        throw new GraphError(
          `Reading ${source.name} needs ffmpeg and ffprobe on PATH. Install them, or drop the clip.`,
        );
      }
      const found = await probe(source.path);
      return {
        parts: (await frames(source.path, found.durationS)).map((base64) => ({
          mediaType: 'image/jpeg',
          base64,
        })),
        durationS: found.durationS,
        aspectRatio: found.aspectRatio,
      };
    }

    throw new GraphError(
      `${source.name} is a track, and the command line cannot measure one yet — ` +
        `tempo, key and loudness are counted in the desktop host. Read it there and keep the ` +
        `reading; a kept reading works everywhere.`,
    );
  };
}

/**
 * Scanning a folder, for the Folder node the window keeps in its own half.
 *
 * Unreadable files are skipped rather than failing the run: a folder of
 * photographs with a stray text file in it is still a folder of photographs.
 */
const folderNode: NodeSpec = {
  type: 'folder',
  title: 'Folder',
  group: 'in',
  inputs: {},
  outputs: { out: { type: 'source' } },
  async run(_inputs, params) {
    const dir = typeof params.dir === 'string' ? params.dir : '';
    if (!dir) throw new GraphError('This Folder node names no folder.');

    const found = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .flatMap((e) => {
        const kind = kindOf(e.name);
        return kind ? [{ path: join(dir, e.name), name: e.name, kind }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    if (found.length === 0) {
      throw new GraphError(`Nothing readable in ${dir} — no stills, clips or tracks.`);
    }
    return { out: found.map((source) => ({ type: 'source' as const, source })) };
  },
};

/** Where prompts land. One file each, named by what the document is called. */
function saveNode(outDir: string): NodeSpec {
  return {
    type: 'save',
    title: 'Save',
    group: 'out',
    inputs: { prompts: { type: 'prompt', whole: true } },
    outputs: {},
    async run(inputs) {
      const list = Array.isArray(inputs.prompts) ? (inputs.prompts as Signal) : [];
      await mkdir(outDir, { recursive: true });

      const taken = new Set<string>();
      let n = 0;
      for (const value of list) {
        if (value.type !== 'prompt') continue;
        n += 1;
        await writeFile(
          join(outDir, promptFileName(value.prompt, n, taken)),
          value.prompt.render.text,
          'utf8',
        );
      }
      return {};
    },
  };
}

export interface GraphRunOptions {
  file: string;
  out: string;
  gateway: Parameters<typeof runGraph>[2]['gateway'];
  registry: Parameters<typeof runGraph>[2]['registry'];
  library?: Parameters<typeof runGraph>[2]['library'];
  onNode?: (line: string) => void;
}

export interface GraphRunReport {
  ran: number;
  cached: number;
  prompts: number;
}

export async function runGraphFile(options: GraphRunOptions): Promise<GraphRunReport> {
  const text = await readFile(options.file, 'utf8');
  const doc = JSON.parse(text) as GraphDoc;
  if (!doc || !Array.isArray(doc.nodes)) {
    throw new GraphError(`${basename(options.file)} is not a graph.`);
  }

  const tools = { ffmpeg: await has('ffmpeg'), ffprobe: await has('ffprobe') };

  // The portable catalogue, plus the two nodes that need a disk. The window
  // supplies its own pair; neither knows about the other.
  const nodes = new Map(BUILTIN_NODES);
  nodes.set(folderNode.type, folderNode);
  const save = saveNode(options.out);
  nodes.set(save.type, save);

  const result = await runGraph(
    doc,
    nodes,
    {
      gateway: options.gateway,
      registry: options.registry,
      ...(options.library ? { library: options.library } : {}),
      resolve: resolverFor(tools),
    },
    {
      onEvent: (e) => {
        if (e.phase === 'done') options.onNode?.(`  ${e.node}${e.times && e.times > 1 ? ` ×${e.times}` : ''}`);
        if (e.phase === 'cached') options.onNode?.(`  ${e.node} · already known`);
        if (e.phase === 'failed') options.onNode?.(`  ${e.node} · ${e.error ?? 'failed'}`);
      },
    },
  );

  // Every prompt the graph produced, wherever it came out.
  let prompts = 0;
  for (const ports of result.outputs.values()) {
    for (const signal of Object.values(ports)) {
      prompts += signal.filter((v) => v.type === 'prompt').length;
    }
  }

  return { ran: result.ran.length, cached: result.cached.length, prompts };
}

/** Extensions this can open at all, for the usage text. */
export const READABLE = ['image files', 'clips (with ffmpeg)'].join(', ');

export const extensionOf = (name: string): string => extname(name).slice(1).toLowerCase();
