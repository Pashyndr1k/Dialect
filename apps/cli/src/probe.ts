/**
 * The live pass: every prompt, once, against a real model.
 *
 * This project has a lot of carefully written system prompts and, until this
 * ran, almost none of them had ever been read by the thing they were written
 * for. Every test drives a MockProvider that hands back whatever the test said
 * — which proves the plumbing and proves nothing whatever about the prompts.
 *
 * So each step here exercises one prompt end to end and writes down what came
 * back. The point is not that it did not throw. The point is the answer, in
 * full, in a file, so a person can read it and say whether the prompt asked for
 * the right thing.
 *
 * `--dry` builds every request and prints it without calling anything. That is
 * how the wording gets reviewed before a penny is spent, and how this file was
 * itself checked.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  applyVariant,
  composeBundle,
  expandIdea,
  extractFromAudio,
  extractFromImages,
  extractFromVideo,
  fillTemplate,
  Gateway,
  learnTemplate,
  sceneLines,
  vary,
  type Bundle,
  type BundleItem,
  type ImagePart,
  type Provider,
  type ProviderResult,
  type StructuredRequest,
  ZERO_USAGE,
} from '@dialect/core';
import { loadBuiltinLibrary } from '@dialect/core/templates-node';

/**
 * A stand-in answer, shaped like whatever was asked for.
 *
 * A dry run that threw on the first call only ever showed the first request —
 * so `compose`, which reads a reference before composing anything, reported the
 * reading and never built the thing it exists to check. Answering instead of
 * throwing lets every step run to its end with no model involved.
 */
function stubFor(schema: unknown): unknown {
  const def = (schema as { def?: Record<string, unknown> }).def;
  const kind = def?.['type'] as string | undefined;

  switch (kind) {
    case 'object': {
      const shape = (def?.['shape'] ?? {}) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, stubFor(v)]));
    }
    case 'array':
      return [];
    case 'number':
      return 1;
    case 'boolean':
      return false;
    case 'enum': {
      const entries = def?.['entries'] as Record<string, string> | undefined;
      return Object.values(entries ?? {})[0] ?? '';
    }
    case 'optional':
    case 'nullable':
      return stubFor(def?.['innerType']);
    default:
      return 'stub';
  }
}

/** Records what it was asked and answers with a stub, so a step runs to its end. */
class DryProvider implements Provider {
  readonly id = 'dry';
  readonly model = 'none';
  readonly seen: Array<StructuredRequest<unknown>> = [];

  async extract<T>(request: StructuredRequest<T>): Promise<ProviderResult<T>> {
    this.seen.push(request as StructuredRequest<unknown>);

    const parsed = request.schema.safeParse(stubFor(request.schema));
    if (!parsed.success) {
      throw new Error(
        `the stub did not satisfy ${request.schemaVersion} — the request was still recorded`,
      );
    }
    return { value: parsed.data, usage: ZERO_USAGE, model: 'none' };
  }
}

function describeRequest(request: StructuredRequest<unknown>, n: number, of: number): string {
  const shape = (request.schema as unknown as { shape?: object }).shape;
  return [
    `=== request ${n} of ${of} ===`,
    `# schema: ${request.schemaVersion}`,
    `# images: ${request.images?.length ?? 0}`,
    `# fields: ${shape ? Object.keys(shape).join(', ') : '(not an object schema)'}`,
    '',
    '--- SYSTEM ---',
    request.system,
    '',
    '--- INSTRUCTION ---',
    request.instruction,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Media, from one clip
// ---------------------------------------------------------------------------

function ffmpeg(args: string[]): Buffer | undefined {
  const out = spawnSync('ffmpeg', ['-v', 'error', ...args], { maxBuffer: 64 * 1024 * 1024 });
  return out.status === 0 && out.stdout.length > 0 ? out.stdout : undefined;
}

const asPart = (bytes: Buffer): ImagePart => ({
  mediaType: 'image/jpeg',
  base64: bytes.toString('base64'),
});

/**
 * Every modality out of one file.
 *
 * A clip holds a still, a sequence of stills, and — if it was recorded with
 * sound — something to draw a spectrogram of. One fixture rather than three
 * keeps the probe honest about what it is actually testing.
 */
function mediaFrom(clip: string): {
  stills: ImagePart[];
  frames: ImagePart[];
  sound: ImagePart[];
} {
  const at = (t: string) =>
    ffmpeg(['-ss', t, '-i', clip, '-frames:v', '1', '-vf', "scale='min(768,iw)':-2", '-q:v', '4', '-f', 'image2', '-']);

  const stills = [at('0.5')].filter(Boolean).map((b) => asPart(b!));
  const frames = ['0.3', '1.6', '3.0', '4.4', '5.8']
    .map(at)
    .filter(Boolean)
    .map((b) => asPart(b!));

  const spectrogram = ffmpeg([
    '-i', clip,
    '-lavfi', 'showspectrumpic=s=1024x512:mode=combined:legend=disabled:scale=log',
    '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2', '-',
  ]);

  return { stills, frames, sound: spectrogram ? [asPart(spectrogram)] : [] };
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

export interface Step {
  name: string;
  /** What this one proves that no other step does. */
  proves: string;
  run(gateway: Gateway, media: ReturnType<typeof mediaFrom>): Promise<unknown>;
}

/**
 * A character kept earlier, and a look kept earlier.
 *
 * Written out rather than read from a picture, because that is exactly what a
 * kept source is: lines that were paid for once and are text from then on. No
 * image goes into this call at all.
 *
 * The look is a snowy street on purpose. The composer is told that a style
 * source lends its grade and its light and nothing else — so if snow turns up
 * in the picture, the sentence it is told is not working, and that is the most
 * useful thing this run could find out.
 */
const KEPT_SUBJECT: BundleItem = {
  id: 'the-cowboy',
  kind: 'image',
  role: 'subject',
  lines: [
    'Subject: an aged cowboy leaning on a saloon bar',
    'Who 1: the cowboy — a weathered man in his late sixties, deeply lined face, silver-grey ' +
      'stubble, sun-darkened leathery skin, a dust-covered brown duster coat with frayed cuffs, ' +
      'a worn brown leather hat dented from years of road use',
    'Action: rests both forearms on the counter',
  ],
};

const KEPT_LOOK: BundleItem = {
  id: 'winter-street',
  kind: 'image',
  role: 'style',
  lines: [
    'Subject: a snowy street at dusk, nobody in it',
    'Place: a terraced street under heavy snowfall',
    'Place detail: sodium lamps, tyre tracks through deep snow, a buried kerb',
    'Key light: sodium street lamps through falling snow',
    'Contrast: high, deep crushed blacks',
    'Colour temperature: warm lamps against blue snow',
    'Optics: halation blooming around every light',
    'Grade: cold shadows, warm highlights',
    'Grain: heavy',
    'Medium: 35mm film still, pushed two stops',
  ],
};

const EXAMPLE_PROMPT = `Full-body character concept for a dark fantasy RPG. A
grizzled dwarven smith, broad and low-slung, beard braided with iron rings, soot
ground into the creases of his hands. Hand-painted texture, thick confident
brushwork, visible canvas grain. Three-quarter view, neutral A-pose, plain slate
background, even studio light with a warm rim from the left. No text, no
watermark, no border.`;

export async function stepsFor(): Promise<Step[]> {
  const library = await loadBuiltinLibrary();

  return [
    {
      name: 'read-image',
      proves: 'EXTRACTION_SYSTEM — the only prompt with any live history',
      run: async (gateway, media) =>
        (await extractFromImages(gateway, media.stills, { reference: 'probe.jpg' })).scene,
    },
    {
      name: 'read-image-with-words',
      proves: 'notedInstruction — that a note steers a reading without becoming a diff',
      run: async (gateway, media) =>
        (
          await extractFromImages(gateway, media.stills, {
            reference: 'probe.jpg',
            note: 'at night, and older',
          })
        ).scene,
    },
    {
      name: 'read-clip',
      proves: 'SHOT_SYSTEM — that movement is read from how frames differ',
      run: async (gateway, media) =>
        (await extractFromVideo(gateway, media.frames, { reference: 'probe.mp4', durationS: 6.4 }))
          .shot,
    },
    {
      name: 'read-track',
      proves: 'SONG_SYSTEM — that a spectrogram yields something, and admits what it cannot tell',
      run: async (gateway, media) =>
        (await extractFromAudio(gateway, media.sound, { reference: 'probe.mp3', durationS: 6.4 }))
          .song,
    },
    {
      name: 'idea-to-document',
      proves: 'IDEA_SYSTEM — that it decides rather than hedges',
      run: async (gateway) =>
        (await expandIdea(gateway, 'a red door in the rain', { modality: 'image' })).ir,
    },
    {
      name: 'idea-into-template',
      proves: "TEMPLATE_SYSTEM — that it answers the template's questions and nothing else",
      run: async (gateway) =>
        (await fillTemplate(gateway, 'a cowboy at a bar', library, 'cinematic-shot')).values,
    },
    {
      name: 'compose',
      proves: 'COMPOSE_SYSTEM — the one that has never run, and the one roles depend on',
      run: async (gateway, media) => {
        // A reading is needed first, so this step is the expensive one.
        const read = await extractFromImages(gateway, media.stills, { reference: 'subject.jpg' });

        const bundle: Bundle = {
          modality: 'image',
          items: [
            { id: 'words', kind: 'words', role: 'auto', lines: ['make it a winter street at dusk'] },
            { id: 'subject.jpg', kind: 'image', role: 'subject', lines: sceneLines(read.scene) },
          ],
        };
        return (await composeBundle(gateway, bundle)).ir;
      },
    },
    {
      name: 'compose-kept',
      proves:
        'that a style source lends its light and not its snow — the claim the whole ' +
        'role system rests on, and the one no test can check',
      run: async (gateway) => {
        const bundle: Bundle = {
          modality: 'image',
          items: [
            { id: 'words', kind: 'words', role: 'auto', lines: ['at night, and it is raining'] },
            KEPT_SUBJECT,
            KEPT_LOOK,
          ],
        };
        return (await composeBundle(gateway, bundle)).ir;
      },
    },
    {
      name: 'vary',
      proves: 'VARY_SYSTEM — that eight versions differ from each other and hold the axis',
      run: async (gateway) => {
        // Built from the kept sources rather than read, so this step buys only
        // the varying and nothing else.
        const base = {
          ...(await composeBundle(gateway, {
            modality: 'image',
            items: [KEPT_SUBJECT],
          })).ir,
        };

        const { variants } = await vary(gateway, base, { axis: 'subject', count: 8 });
        return {
          base: { headline: base.subject?.headline, medium: base.style?.medium },
          variants,
          applied: variants.map((v) => {
            const next = applyVariant(base, 'subject', v);
            return {
              label: next.title,
              headline: next.subject?.headline,
              // Off the axis, and therefore expected to be identical in all eight.
              medium: next.style?.medium,
              location: next.environment?.location,
            };
          }),
        };
      },
    },
    {
      name: 'learn-template',
      proves: 'LEARN_SYSTEM — that it finds the seams instead of rewriting the prompt',
      run: async (gateway) =>
        (
          await learnTemplate(gateway, EXAMPLE_PROMPT, {
            kind: 'text2img',
            cast: 1,
            name: 'Probe characters',
            // As the window does it, or the probe would not be probing the window.
            writtenFor: 'nano-banana-2',
          })
        ).template,
    },
  ];
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export interface ProbeOptions {
  clip: string;
  out: string;
  dry: boolean;
  only?: string[];
  provider: Provider;
  budgetUsd: number;
  log: (line: string) => void;
}

export interface StepOutcome {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runProbe(options: ProbeOptions): Promise<StepOutcome[]> {
  const { log } = options;
  const media = mediaFrom(options.clip);

  log(`media: ${media.stills.length} still, ${media.frames.length} frames, ${media.sound.length} spectrogram\n`);
  if (media.stills.length === 0) {
    throw new Error(`ffmpeg produced nothing from ${options.clip}. Is it on PATH?`);
  }

  const all = await stepsFor();
  const steps = options.only ? all.filter((s) => options.only!.includes(s.name)) : all;
  await mkdir(options.out, { recursive: true });

  const outcomes: StepOutcome[] = [];
  let spent = 0;

  for (const step of steps) {
    // A fresh gateway per step, carrying the running total in. A cap that
    // applied to each step on its own would let eight steps spend eight times
    // what anyone thought they had agreed to.
    const dryProvider = options.dry ? new DryProvider() : undefined;
    const gateway = new Gateway(dryProvider ?? options.provider, {
      budgetUsd: options.budgetUsd,
    });
    gateway.restoreSpend(spent);

    log(`── ${step.name}\n   ${step.proves}\n`);
    let failure: string | undefined;

    try {
      const answer = await step.run(gateway, media);
      if (!options.dry) {
        await writeFile(
          join(options.out, `${step.name}.json`),
          `${JSON.stringify(answer, null, 2)}\n`,
        );
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      // Whatever it managed to spend before falling over still counts.
      spent = Math.max(spent, gateway.spentUsd);
    }

    if (dryProvider) {
      // Written whether or not the step finished: a request that was built is
      // worth reading even if what came after it fell over.
      const seen = dryProvider.seen;
      await writeFile(
        join(options.out, `${step.name}.request.txt`),
        [
          `# ${step.name} — ${step.proves}`,
          '',
          ...seen.map((r, i) => describeRequest(r, i + 1, seen.length)),
        ].join('\n'),
      );

      const words = seen.reduce((n, r) => n + (r.system + r.instruction).split(/\s+/).length, 0);
      const images = seen.reduce((n, r) => n + (r.images?.length ?? 0), 0);
      const detail = `${seen.length} request${seen.length === 1 ? '' : 's'}, ${images} images, ~${words} words`;

      log(`   built · ${detail}${failure ? ` · ${failure}` : ''}\n\n`);
      outcomes.push({ name: step.name, ok: seen.length > 0 && !failure, detail });
      continue;
    }

    if (failure) {
      log(`   FAILED · ${failure}\n\n`);
      outcomes.push({ name: step.name, ok: false, detail: failure });
      continue;
    }

    const cost = gateway.spentUsd - spent;
    spent = gateway.spentUsd;

    log(`   ok · $${cost.toFixed(4)} · running $${spent.toFixed(4)} · ${step.name}.json

`);
    outcomes.push({ name: step.name, ok: true, detail: `$${cost.toFixed(4)}` });
  }

  if (!options.dry) log(`total $${spent.toFixed(4)} of $${options.budgetUsd.toFixed(2)}

`);
  return outcomes;
}

/** The report, so a run can be read later rather than scrolled past. */
export async function writeReport(
  dir: string,
  outcomes: StepOutcome[],
  dry: boolean,
): Promise<void> {
  const lines = [
    `# Live pass — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    dry ? '\nDry: every request was built, none was sent.\n' : '',
    ...outcomes.map((o) => `- ${o.ok ? 'ok' : 'FAILED'}  ${o.name}  ${o.detail}`),
    '',
    dry
      ? 'Read the .request.txt files: that is exactly what a live run would send.'
      : 'Read the .json files. The question is not whether they parsed — it is whether the answer is any good.',
    '',
  ];
  await writeFile(join(dir, 'report.md'), lines.join('\n'));
}

/** Used by the CLI to say where the fixture clip lives. */
export const DEFAULT_CLIP = join(
  process.cwd(),
  'apps/desktop/src-tauri/tests/fixtures/clip.mp4',
);

export const clipExists = async (path: string): Promise<boolean> =>
  readFile(path).then(
    () => true,
    () => false,
  );
