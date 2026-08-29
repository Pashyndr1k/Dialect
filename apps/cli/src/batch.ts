/**
 * `dialect batch` — a folder of references in, a folder of prompts out.
 *
 * The queue, the cache and the budget all live in core; this is the part that
 * knows about directories. State and cache are written inside the output
 * folder, so a run is resumed by pointing at the same place again and costs
 * nothing for what it already did.
 */

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { stderr, stdout } from 'node:process';

import {
  compile,
  createQueue,
  extractFromImage,
  Gateway,
  getProfile,
  runQueue,
  summarise,
  toDocument,
  type ModelProfile,
  type Provider,
  type QueueState,
  type Registry,
} from '@dialect/core';
import { FileCache } from '@dialect/core/cache-node';
import { AnthropicProvider } from '@dialect/providers';

const MEDIA: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const STATE_FILE = 'batch-state.json';
const CACHE_DIR = 'cache';

export interface BatchOptions {
  folder: string;
  out: string;
  target: string;
  registry: Registry;
  budgetUsd: number;
  concurrency: number;
  /** Output file name, e.g. `{{basename}}_{{target}}.txt`. */
  nameAs: string;
  /** Ignore any saved state and start over. */
  restart: boolean;
  /**
   * Who answers. Defaults to Anthropic; the tests hand it a mock, which is the
   * only way to exercise a thousand-file run without paying for one.
   */
  provider?: Provider;
}

function fileNameFor(pattern: string, ref: string, profile: ModelProfile): string {
  return pattern
    .replace(/\{\{\s*basename\s*\}\}/g, basename(ref, extname(ref)))
    .replace(/\{\{\s*target\s*\}\}/g, profile.id)
    .replace(/\{\{\s*ext\s*\}\}/g, extname(ref).slice(1));
}

async function loadState(path: string): Promise<QueueState | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as QueueState;
  } catch {
    return undefined;
  }
}

/**
 * Written aside and renamed, so a crash cannot truncate the resume point.
 *
 * Serialised, because every worker persists after every change: two overlapping
 * writes would race on the temporary file and one rename would find it already
 * gone. The state is a whole snapshot, so the last writer winning is correct.
 */
function stateWriter(path: string): (state: QueueState) => Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  let queue: Promise<void> = Promise.resolve();

  return (state) => {
    const snapshot = `${JSON.stringify(state, null, 2)}\n`;
    queue = queue.then(async () => {
      await writeFile(temp, snapshot, 'utf8');
      await rename(temp, path);
    });
    return queue;
  };
}

export async function runBatch(options: BatchOptions): Promise<number> {
  const profile = getProfile(options.registry, options.target);
  const folder = resolve(options.folder);
  const out = resolve(options.out);

  const names = (await readdir(folder))
    .filter((n) => MEDIA[extname(n).toLowerCase()] !== undefined)
    .sort();

  if (names.length === 0) {
    stderr.write(`No images in ${folder}. Looked for ${Object.keys(MEDIA).join(', ')}.\n`);
    return 1;
  }

  await mkdir(out, { recursive: true });
  const statePath = join(out, STATE_FILE);
  const saveState = stateWriter(statePath);

  const saved = options.restart ? undefined : await loadState(statePath);
  const state =
    saved && saved.items.length === names.length
      ? saved
      : createQueue(names.map((n) => ({ id: n, ref: join(folder, n) })));

  const already = summarise(state);
  if (already.done > 0) {
    stdout.write(`Resuming: ${already.done} of ${names.length} already done.\n`);
  }
  stdout.write(`${names.length} references -> ${out}\n`);

  // The cap covers the whole run, not this process, so what earlier runs spent
  // comes off the top.
  const remainingBudget = Math.max(0, options.budgetUsd - state.spentUsd);
  const gateway = new Gateway(options.provider ?? new AnthropicProvider(), {
    cache: new FileCache(join(out, CACHE_DIR)),
    budgetUsd: remainingBudget,
    onSpend: (_usage, total) => {
      state.spentUsd = (saved?.spentUsd ?? 0) + total;
    },
  });

  let finished = 0;
  const summary = await runQueue(state, {
    concurrency: options.concurrency,
    onChange: saveState,
    work: async (item) => {
      const mediaType = MEDIA[extname(item.ref).toLowerCase()]!;
      const image = { mediaType, base64: (await readFile(item.ref)).toString('base64') };

      const { ir, cached } = await extractFromImage(gateway, image, { reference: item.id });
      const result = compile(ir, profile);

      const name = fileNameFor(options.nameAs, item.id, profile);
      await writeFile(join(out, name), toDocument(result.render, profile, { title: ir.title }), 'utf8');
      await writeFile(
        join(out, `${basename(name, extname(name))}.ir.json`),
        `${JSON.stringify(ir, null, 2)}\n`,
        'utf8',
      );

      finished += 1;
      stdout.write(
        `  ${String(finished).padStart(String(names.length).length)}/${names.length} ` +
          `${item.id}${cached ? ' (cached)' : ''}` +
          `${result.blocked ? ' — blocked by a rule' : ''}\n`,
      );

      return { name, blocked: result.blocked, findings: result.findings.length };
    },
  });

  await saveState(state);

  stdout.write(
    `\n${summary.done} written, ${summary.failed} failed, ${summary.remaining} left. ` +
      `$${state.spentUsd.toFixed(4)} spent.\n`,
  );

  if (state.stoppedBecause) {
    stderr.write(`\nStopped early: ${state.stoppedBecause}\n`);
    stderr.write(`Raise --budget and run the same command again to pick up where it left off.\n`);
    return 1;
  }

  if (summary.failed > 0) {
    stderr.write('\nFailed:\n');
    for (const item of state.items.filter((i) => i.state === 'failed')) {
      stderr.write(`  ${item.id}: ${item.error ?? 'no reason recorded'}\n`);
    }
    return 1;
  }

  return 0;
}
