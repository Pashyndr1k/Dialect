/**
 * The `shot-description` form: a director's instruction in prose.
 *
 * The model reads the first line first, so the shot type and the single camera
 * move are front-loaded there rather than buried next to the action. Sound is
 * part of the prompt, not an afterthought — omni models generate picture and
 * audio in one pass, which is also why "no music" and "no subtitles" are stated
 * outright: generated music cannot be separated later, and burned-in captions
 * cannot be removed at all.
 */

import type { PromptIR } from '../ir/types.ts';
import type { ModelProfile } from '../registry/types.ts';
import type { RenderResult, Segment } from './types.ts';
import { assembleText, joinParts } from './types.ts';

const SHOT_LABELS: Record<string, string> = {
  'extreme-wide': 'extreme wide shot',
  wide: 'wide shot',
  'medium-wide': 'medium wide shot',
  medium: 'medium shot',
  'medium-close': 'medium close-up',
  'close-up': 'close-up',
  'extreme-close-up': 'extreme close-up',
  'two-shot': 'two-shot',
  'over-shoulder': 'over-the-shoulder shot',
};

function sentence(s: string | undefined): string {
  const t = (s ?? '').trim();
  if (!t) return '';
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/**
 * Join prose that may already contain full stops. Comma-splicing a paragraph
 * onto a phrase is what produces "…settling from his entrance., slow push-in."
 */
function sentences(parts: Array<string | undefined>): string {
  return parts.map(sentence).filter(Boolean).join(' ');
}

/** Only portrait needs calling out; naming a landscape ratio "vertical" is just wrong. */
function orientation(ratio: string | undefined): string | undefined {
  if (!ratio) return undefined;
  const [w, h] = ratio.split(':').map((n) => Number.parseFloat(n));
  if (!w || !h || Number.isNaN(w) || Number.isNaN(h)) return undefined;
  return h > w ? 'Vertical' : undefined;
}

function movePhrase(ir: PromptIR): string | undefined {
  const cm = ir.cameraMove;
  if (!cm) return undefined;
  if (cm.move === 'static') return 'locked-off camera';
  return joinParts([cm.speed && cm.speed !== 'medium' ? cm.speed : undefined, cm.move], ' ');
}

export function renderShotDescription(ir: PromptIR, profile: ModelProfile): RenderResult {
  const segments: Segment[] = [];
  const push = (label: string, from: string[], text: string): void => {
    const t = text.trim();
    if (t) segments.push({ label, from, text: t, source: 'ir' });
  };

  const refSyntax = profile.supports?.refSyntax;
  const refs =
    refSyntax && ir.references?.length ? ir.references.map((r) => r.id).join(' ') : undefined;
  if (refs) push('References', ['references'], refs);

  // Front-loaded: framing first, then the one camera move.
  push(
    'Shot',
    ['shot', 'cameraMove'],
    sentence(
      joinParts([
        joinParts(
          [
            orientation(ir.shot?.aspectRatio),
            ir.shot?.aspectRatio,
            ir.shot?.size ? SHOT_LABELS[ir.shot.size] ?? ir.shot.size : undefined,
            ir.shot?.angle,
          ],
          ' ',
        ),
        movePhrase(ir),
      ]),
    ),
  );

  push('Action', ['subject'], sentences([ir.subject?.headline, ir.subject?.action]));

  push(
    'Environment',
    ['environment'],
    sentences([
      joinParts([ir.environment?.location, ir.environment?.timeOfDay]),
      ir.environment?.description,
    ]),
  );

  push(
    'Look',
    ['lighting', 'style', 'texture', 'optics', 'palette'],
    sentence(
      joinParts([
        ir.lighting?.key,
        ...(ir.lighting?.sources ?? []),
        ...(ir.lighting?.lookWords ?? []),
        ir.optics?.effect,
        ir.palette?.grade,
        ir.texture?.grain === 'fine-uniform' ? 'fine uniform film grain' : undefined,
      ]),
    ),
  );

  push('Atmosphere', ['mood'], sentence(ir.mood?.atmosphere));

  for (const line of ir.dialogue ?? []) {
    const who = ir.subject?.entities?.find((e) => e.id === line.speaker)?.name ?? 'The subject';
    const how = line.delivery?.length ? `, ${line.delivery.join(', ')},` : '';
    // Dialogue is quoted verbatim so the model speaks it rather than paraphrasing it.
    push('Dialogue', ['dialogue'], `${who} says${how} "${line.line}"`);
  }

  const sound = ir.sound;
  if (sound) {
    const parts: string[] = [];
    if (sound.sfx?.length) parts.push(`SFX: ${sound.sfx.join(', ')}.`);
    if (sound.ambience) parts.push(sentence(sound.ambience));
    if (sound.music === false) parts.push('No music.');
    if (sound.subtitles === false) parts.push('No subtitles.');
    push('Sound', ['sound'], parts.join(' '));
  }

  const assembly = { separator: ' ', labelled: false, prefixLabel: 'References' };
  const text = assembleText({ segments, assembly });

  const params: Record<string, string> = {};
  if (ir.shot?.aspectRatio) params['aspect_ratio'] = ir.shot.aspectRatio;
  if (ir.shot?.durationS !== undefined) params['duration'] = `${ir.shot.durationS} seconds`;

  return { target: profile.id, segments, text, assembly, params };
}
