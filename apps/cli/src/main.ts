#!/usr/bin/env node
/**
 * `dialect` — the command-line surface over @dialect/core.
 *
 * Exists mostly to prove the point: the compiler has no opinion about who is
 * driving it. The desktop app will call the same `compile()` with the same IR
 * and get the same bytes back.
 */

import { readFile } from 'node:fs/promises';
import { argv, exit, stderr, stdout } from 'node:process';

import { compile, getProfile, toDocument, type PromptIR } from '@dialect/core';
import { loadBuiltinRegistry } from '@dialect/core/node';

const USAGE = `dialect — compile a Prompt IR into one model's dialect

  dialect compile <ir.json> --target <model-id> [--prompt-only]
  dialect targets [--job <job>]

Options
  --target        model id from the registry, e.g. kling-3-omni
  --prompt-only   print just the prompt, without the title and settings
  --job           filter targets by the job they are best at
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

async function main(): Promise<number> {
  switch (argv[2]) {
    case 'compile':
      return cmdCompile();
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
