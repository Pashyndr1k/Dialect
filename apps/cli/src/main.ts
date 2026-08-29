#!/usr/bin/env node
/**
 * `dialect` — the command-line surface over @dialect/core.
 *
 * Exists mostly to prove the point: the compiler has no opinion about who is
 * driving it. The desktop app will call the same `compile()` with the same IR
 * and get the same bytes back.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { argv, exit, stderr, stdout } from 'node:process';

import {
  compile,
  extractFromImage,
  Gateway,
  getProfile,
  toDocument,
  type Modality,
  type PromptIR,
} from '@dialect/core';
import { loadBuiltinRegistry } from '@dialect/core/node';
import { AnthropicProvider } from '@dialect/providers';

const USAGE = `dialect — compile a Prompt IR into one model's dialect

  dialect compile <ir.json> --target <model-id> [--prompt-only]
  dialect extract <image>   --target <model-id> [--budget <usd>] [--ir-out <file>]
  dialect targets [--job <job>]

Options
  --target        model id from the registry, e.g. kling-3-omni
  --prompt-only   print just the prompt, without the title and settings
  --job           filter targets by the job they are best at
  --budget        stop before spending more than this many dollars (default 1.00)
  --ir-out        write the extracted Prompt IR to a file, to edit and recompile
  --modality      what the prompt is for: image (default), video or audio

extract needs Anthropic credentials: set ANTHROPIC_API_KEY, or run 'ant auth login'.
`;

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const LEVEL_MARK: Record<string, string> = { autofix: '·', warn: '!', block: '✕' };

async function cmdTargets(): Promise<number> {
  const registry = await loadBuiltinRegistry();
  const job = flag('job');

  const rows = [...registry.profiles.values()]
    .filter((p) => (job ? p.bestFor?.includes(job) : true))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (rows.length === 0) {
    stderr.write(job ? `No target is marked best for "${job}".\n` : 'The registry is empty.\n');
    return 1;
  }
  for (const p of rows) {
    stdout.write(`${p.id.padEnd(18)} ${p.family.padEnd(6)} ${p.label}\n`);
    if (p.routingNote) stdout.write(`${' '.repeat(19)}${p.routingNote.trim().replace(/\s+/g, ' ')}\n`);
  }
  return 0;
}

async function cmdCompile(): Promise<number> {
  const file = argv[3];
  const target = flag('target');

  if (!file || !target) {
    stderr.write(USAGE);
    return 2;
  }

  const ir = JSON.parse(await readFile(file, 'utf8')) as PromptIR;
  const registry = await loadBuiltinRegistry();
  const profile = getProfile(registry, target);
  const result = compile(ir, profile);

  stdout.write(
    argv.includes('--prompt-only')
      ? `${result.render.text}\n`
      : toDocument(result.render, profile, { title: ir.title }),
  );

  if (result.findings.length > 0) {
    stderr.write('\n');
    for (const f of result.findings) {
      stderr.write(`${LEVEL_MARK[f.level] ?? '·'} [${f.ruleId}] ${f.message}\n`);
      if (f.fix) stderr.write(`  → ${f.fix}\n`);
    }
  }

  // A blocked prompt is still printed, so the author can see what the rule
  // objected to — but the exit code says it must not ship.
  return result.blocked ? 1 : 0;
}


const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

async function cmdExtract(): Promise<number> {
  const file = argv[3];
  const target = flag('target');

  if (!file || !target) {
    stderr.write(USAGE);
    return 2;
  }

  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) {
    stderr.write(
      `Cannot read "${file}": ${ext} is not an image type this reads. ` +
        `Supported: ${Object.keys(MEDIA_TYPES).join(', ')}.\n`,
    );
    return 2;
  }

  const registry = await loadBuiltinRegistry();
  const profile = getProfile(registry, target);

  const budget = Number.parseFloat(flag('budget') ?? '1.00');
  const gateway = new Gateway(new AnthropicProvider(), {
    budgetUsd: budget,
    onSpend: (_usage, total) => stderr.write(`  spent $${total.toFixed(4)}\n`),
  });

  stderr.write(`Reading ${file}...\n`);
  const image = { mediaType, base64: (await readFile(file)).toString('base64') };

  const modality = (flag('modality') ?? 'image') as Modality;
  const { ir, cached } = await extractFromImage(gateway, image, {
    reference: file,
    modality,
  });
  if (cached) stderr.write('  (already known, nothing spent)\n');

  const irOut = flag('ir-out');
  if (irOut) {
    await writeFile(irOut, `${JSON.stringify(ir, null, 2)}\n`, 'utf8');
    stderr.write(`  IR written to ${irOut}\n`);
  }

  const result = compile(ir, profile);
  stdout.write(toDocument(result.render, profile, { title: ir.title }));

  if (result.findings.length > 0) {
    stderr.write('\n');
    for (const f of result.findings) {
      stderr.write(`${LEVEL_MARK[f.level] ?? '·'} [${f.ruleId}] ${f.message}\n`);
      if (f.fix) stderr.write(`  → ${f.fix}\n`);
    }
  }

  return result.blocked ? 1 : 0;
}

async function main(): Promise<number> {
  switch (argv[2]) {
    case 'compile':
      return cmdCompile();
    case 'extract':
      return cmdExtract();
    case 'targets':
      return cmdTargets();
    default:
      stderr.write(USAGE);
      return 2;
  }
}

main().then(
  (code) => exit(code),
  (err: unknown) => {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
  },
);
