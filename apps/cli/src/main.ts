#!/usr/bin/env node
/**
 * `dialect` — the command-line surface over @dialect/core.
 *
 * Exists mostly to prove the point: the compiler has no opinion about who is
 * driving it. The desktop app will call the same `compile()` with the same IR
 * and get the same bytes back.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { argv, env as processEnv, exit, platform, stderr, stdout } from 'node:process';

import {
  compile,
  extractFromImage,
  Gateway,
  getProfile,
  toDocument,
  type Modality,
  type PromptIR,
} from '@dialect/core';
import { applyTemplate, chainFor, MissingVariablesError } from '@dialect/core';
import { loadBuiltinRegistry } from '@dialect/core/node';
import { loadBuiltinLibrary } from '@dialect/core/templates-node';
import { runGraphFile } from './graph.ts';
import { runBatch } from './batch.ts';
import { manifestFor, newKeypair, publicKeyOf, signSet } from './sign.ts';
import { clipExists, DEFAULT_CLIP, runProbe, writeReport } from './probe.ts';
import { AnthropicProvider } from '@dialect/providers';

const USAGE = `dialect — compile a Prompt IR into one model's dialect

  dialect compile <ir.json> --target <model-id> [--prompt-only]
  dialect extract <image>   --target <model-id> [--budget <usd>] [--ir-out <file>]
  dialect targets [--job <job>]
  dialect batch <folder>    --target <model-id> --out <dir> [--budget <usd>]
  dialect graph <graph.json> --out <dir> [--budget <usd>]
  dialect templates [--modality <image|video|audio>]
  dialect apply <template-id> --target <model-id> [--set name=value ...] [--ir-out <file>]
  dialect keygen            [--key-out <file>]
  dialect sign <cards-dir>  --key <file> --version <n> [--channel <name>]
  dialect probe             --out <dir> [--dry] [--budget <usd>] [--only a,b]

Options
  --target        model id from the registry, e.g. kling-3-omni
  --prompt-only   print just the prompt, without the title and settings
  --job           filter targets by the job they are best at
  --budget        stop before spending more than this many dollars (default 1.00)
  --ir-out        write the extracted Prompt IR to a file, to edit and recompile
  --modality      what the prompt is for: image (default), video or audio
  --set           fill one template variable; repeat for each
  --out           where a batch writes its prompts, state and cache
  --concurrency   how many references are read at once (default 4)
  --name-as       output file name (default {{basename}}_{{target}}.txt)
  --restart       ignore saved progress and run the folder again
  --key           the signing key, as written by keygen
  --key-out       where keygen writes the private key (default dialect-key.pem)
  --version       the set's version. A machine will not install an older one.
  --channel       which set this is (default dialect-models)
  --dry           build every request and print it; call nothing, spend nothing
  --only          run just these probe steps, by name, comma-separated
  --clip          the media the probe reads (default the test fixture)

extract needs Anthropic credentials: set ANTHROPIC_API_KEY, or run 'ant auth login'.
`;

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const LEVEL_MARK: Record<string, string> = { autofix: '·', warn: '!', block: '✕' };

/**
 * How to run this with a key, in the shell the reader is actually in.
 *
 * A bash line handed to someone in PowerShell is not advice, it is a second
 * error message: PowerShell has no inline environment prefix, so the whole
 * line reads as a command name that does not exist.
 */
const RUN_LINE =
  platform === 'win32'
    ? [
        "  $env:ANTHROPIC_API_KEY = 'sk-ant-...'",
        '  node --experimental-strip-types apps/cli/src/main.ts probe --out probe --budget 1.00',
        '  Remove-Item Env:ANTHROPIC_API_KEY',
      ].join('\n')
    : '  ANTHROPIC_API_KEY=sk-ant-... node --experimental-strip-types apps/cli/src/main.ts probe --out probe --budget 1.00';

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


async function cmdTemplates(): Promise<number> {
  const library = await loadBuiltinLibrary();
  const modality = flag('modality');

  const rows = [...library.templates.values()]
    .filter((t) => (modality ? t.modality === modality : true))
    .sort((a, b) => a.modality.localeCompare(b.modality) || a.name.localeCompare(b.name));

  if (rows.length === 0) {
    stderr.write(modality ? `No ${modality} templates.\n` : 'The library is empty.\n');
    return 1;
  }

  for (const t of rows) {
    stdout.write(`${t.id.padEnd(18)} ${t.modality.padEnd(6)} ${t.name}\n`);
    if (t.extends) stdout.write(`${' '.repeat(19)}extends ${t.extends}\n`);

    // Variables come from the whole chain, so a child shows what it inherits.
    const variables = chainFor(library, t.id).flatMap((x) => x.variables ?? []);
    for (const v of variables) {
      const mark = v.default !== undefined ? `= ${v.default}` : v.required ? '(required)' : '';
      stdout.write(`${' '.repeat(21)}--set ${v.name}=…  ${mark}\n`);
    }
  }
  return 0;
}

/** `--set name=value`, repeated. */
function settings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--set') continue;
    const pair = argv[i + 1] ?? '';
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

async function cmdApply(): Promise<number> {
  const id = argv[3];
  const target = flag('target');
  if (!id || !target) {
    stderr.write(USAGE);
    return 2;
  }

  const library = await loadBuiltinLibrary();
  const registry = await loadBuiltinRegistry();
  const profile = getProfile(registry, target);

  let ir;
  try {
    ({ ir } = applyTemplate(library, id, { values: settings() }));
  } catch (err) {
    if (err instanceof MissingVariablesError) {
      stderr.write(`${err.message}\n`);
      for (const name of err.missing) stderr.write(`  --set ${name}=…\n`);
      return 2;
    }
    throw err;
  }

  const irOut = flag('ir-out');
  if (irOut) {
    await writeFile(irOut, `${JSON.stringify(ir, null, 2)}\n`, 'utf8');
    stderr.write(`IR written to ${irOut}\n`);
  }

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
  return result.blocked ? 1 : 0;
}


/**
 * Run a graph built in the window, here, over whatever it points at.
 *
 * The same runner and the same nodes; only the resolver differs, because core
 * opens no files and each front end brings its own way of doing so.
 */
async function cmdGraph(): Promise<number> {
  const file = argv[3];
  const out = flag('out');

  if (!file || !out) {
    stderr.write(USAGE);
    return 2;
  }

  if (!processEnv['ANTHROPIC_API_KEY']) {
    stderr.write(
      'No key in this shell. The desktop app keeps its key in the OS credential store,\n' +
        'which another process cannot read — that is the point of putting it there.\n\n' +
        `${RUN_LINE}\n\nNothing was spent.\n`,
    );
    return 2;
  }

  const budgetUsd = Number.parseFloat(flag('budget') ?? '5.00');
  const gateway = new Gateway(new AnthropicProvider(), {
    budgetUsd,
    onSpend: (_usage, total) => stdout.write(`  spent $${total.toFixed(4)}\n`),
  });

  stdout.write(`Running ${file}, capped at $${budgetUsd.toFixed(2)}.\n`);

  const report = await runGraphFile({
    file,
    out,
    gateway,
    registry: await loadBuiltinRegistry(),
    library: await loadBuiltinLibrary(),
    onNode: (line) => stdout.write(`${line}\n`),
  });

  stdout.write(
    `\n${report.prompts} prompt(s) · ${report.ran} step(s) run, ` +
      `${report.cached} already known · $${gateway.spentUsd.toFixed(4)}\n`,
  );
  return 0;
}

async function cmdBatch(): Promise<number> {
  const folder = argv[3];
  const target = flag('target');
  const out = flag('out');

  if (!folder || !target || !out) {
    stderr.write(USAGE);
    return 2;
  }

  return runBatch({
    folder,
    out,
    target,
    registry: await loadBuiltinRegistry(),
    budgetUsd: Number.parseFloat(flag('budget') ?? '5.00'),
    concurrency: Number.parseInt(flag('concurrency') ?? '4', 10),
    nameAs: flag('name-as') ?? '{{basename}}_{{target}}.txt',
    restart: argv.includes('--restart'),
  });
}

/**
 * Make a publisher key.
 *
 * The public half is what a machine is told to trust; the private half signs
 * and never leaves here. Printed once and written once, because a key that is
 * emailed around is not a key.
 */
async function cmdKeygen(): Promise<number> {
  const out = flag('key-out') ?? 'dialect-key.pem';
  const { publicKeyHex, privateKeyPem } = newKeypair();

  await writeFile(out, privateKeyPem, { mode: 0o600 });
  stdout.write(`Private key written to ${out}. Keep it; it is the only one.\n\n`);
  stdout.write(`Trust this on any machine that should accept your card sets:\n`);
  stdout.write(`${publicKeyHex}\n`);
  return 0;
}

/**
 * Sign a folder of cards so a machine that trusts the key will install them.
 *
 * The version has to be given rather than guessed: it is what stops a set being
 * replaced by an older one, and a number invented here would be a number nobody
 * decided.
 */
async function cmdSign(): Promise<number> {
  const dir = argv[3];
  const keyPath = flag('key');
  const version = Number(flag('version'));

  if (!dir || !keyPath || !Number.isInteger(version) || version < 1) {
    stderr.write('sign needs a folder, --key <file> and --version <n>\n');
    return 2;
  }

  const privateKeyPem = await readFile(keyPath, 'utf8');
  const manifest = await manifestFor(dir, {
    channel: flag('channel') ?? 'dialect-models',
    version,
  });
  await signSet(dir, manifest, privateKeyPem);

  stdout.write(`${manifest.channel} v${manifest.version}, ${manifest.files.length} cards\n`);
  for (const file of manifest.files) {
    stdout.write(`  ${file.name}  ${file.sha256.slice(0, 12)}\n`);
  }
  stdout.write(`\nSigned by ${publicKeyOf(privateKeyPem)}\n`);
  stdout.write(`Point the app at ${dir} — or serve that folder — to install it.\n`);
  return 0;
}

/**
 * Run every prompt once against a real model, and write down what came back.
 *
 * The tests drive a mock that returns whatever the test said, so they prove the
 * plumbing and nothing about the prompts. This is the only thing that does.
 */
async function cmdProbe(): Promise<number> {
  const out = flag('out') ?? 'probe';
  const dry = argv.includes('--dry');
  const clip = flag('clip') ?? DEFAULT_CLIP;
  const only = flag('only')?.split(',').map((s) => s.trim());
  const budgetUsd = Number(flag('budget') ?? '0.60');

  if (!(await clipExists(clip))) {
    stderr.write(`No media at ${clip}. Pass --clip <file>.
`);
    return 2;
  }

  // A dry run must not need credentials: reviewing the wording is the step
  // before deciding whether to pay for the answers.
  //
  // A live one is checked once, here, rather than failing identically eight
  // times with the SDK's own wording — and the desktop key is deliberately out
  // of reach, so the message says what to do rather than what went wrong.
  if (!dry && !processEnv['ANTHROPIC_API_KEY']) {
    stderr.write(
      'No key in this shell. The desktop app keeps its key in the OS credential store,\n' +
        'which another process cannot read — that is the point of putting it there.\n\n' +
        'In your own terminal:\n\n' +
        `${RUN_LINE}\n\n` +
        'Nothing was spent.\n',
    );
    return 2;
  }

  const provider = dry
    ? ({ id: 'none', model: 'none', extract: () => { throw new Error('dry'); } } as never)
    : new AnthropicProvider();

  stdout.write(
    dry
      ? 'Dry run: building every request, sending none.\n\n'
      : `Live run, capped at $${budgetUsd.toFixed(2)} in total. This spends real money.\n\n`,
  );

  const outcomes = await runProbe({
    clip,
    out,
    dry,
    ...(only ? { only } : {}),
    provider,
    budgetUsd,
    log: (line) => stdout.write(line),
  });
  await writeReport(out, outcomes, dry);

  const failed = outcomes.filter((o) => !o.ok);
  stdout.write(`${outcomes.length - failed.length}/${outcomes.length} · report in ${out}/report.md
`);
  return failed.length === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  switch (argv[2]) {
    case 'compile':
      return cmdCompile();
    case 'extract':
      return cmdExtract();
    case 'targets':
      return cmdTargets();
    case 'batch':
      return cmdBatch();
    case 'graph':
      return cmdGraph();
    case 'templates':
      return cmdTemplates();
    case 'apply':
      return cmdApply();
    case 'keygen':
      return cmdKeygen();
    case 'sign':
      return cmdSign();
    case 'probe':
      return cmdProbe();
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
