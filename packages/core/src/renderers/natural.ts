/**
 * The `natural` form: a coherent scene in plain language.
 *
 * The current image line does not want keyword piles. You state the subject and
 * what it is doing, where, in what light, framed how, in which style — and the
 * model builds it. Quality tags do nothing here except harm, which is why the
 * booster rule runs over this output like every other.
 *
 * Words for the frame are placed the way a designer places them: any text that
 * must appear in the image is quoted verbatim and given a position, because
 * unquoted text is read as a theme and gets paraphrased.
 */

import type { PromptIR, TextInImage } from '../ir/types.ts';
import type { ModelProfile } from '../registry/types.ts';
import type { RenderResult, Segment } from './types.ts';
import { joinParts } from './types.ts';

/** A prompt reads as prose, so it opens like one. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Spelling a stubborn word out letter by letter is the documented escape hatch. */
function spelled(word: string): string {
  return word.split('').join(', ');
}

function textClause(t: TextInImage): string {
  const quoted = `"${t.exact}"`;
  const placed = t.placement ? `${quoted} ${t.placement}` : quoted;
  return t.spellOut ? `${placed}, spelled ${spelled(t.exact)}` : placed;
}

export function renderNatural(ir: PromptIR, profile: ModelProfile): RenderResult {
  const segments: Segment[] = [];
  const push = (label: string, from: string[], text: string): void => {
    const t = text.trim();
    if (t) segments.push({ label, from, text: t, source: 'ir' });
  };

  const refSyntax = profile.supports?.refSyntax;
  const refs =
    refSyntax && ir.references?.length ? ir.references.map((r) => r.id).join(' ') : undefined;
  if (refs) push('References', ['references'], refs);

  // Edit mode inverts the discipline: name the one thing that changes, then pin
  // everything else. "Fix the headline" fails; "change X, keep Y exactly" works.
  if (ir.mode === 'edit' && ir.edit) {
    push('Change', ['edit.change'], ir.edit.change);
    const keep = [...(ir.edit.keep ?? []), ...(ir.constraints?.locked ?? [])];
    push(
      'Keep',
      ['edit.keep', 'constraints.locked'],
      keep.length > 0 ? `Keep ${joinParts(keep)} exactly unchanged.` : 'Keep everything else exactly unchanged.',
    );

    const editText = capitalize(
      segments
        .filter((s) => s.label !== 'References')
        .map((s) => (s.label === 'Change' ? `${s.text.replace(/\.$/, '')}.` : s.text))
        .join(' '),
    );

    return {
      target: profile.id,
      segments,
      text: refs ? `${refs} ${editText}` : editText,
      params: {},
    };
  }

  push(
    'Scene',
    ['subject', 'environment', 'shot', 'lighting', 'optics', 'palette', 'style', 'texture'],
    joinParts([
      ir.subject?.headline,
      ir.subject?.action,
      ir.environment?.location,
      ir.environment?.description,
      ir.shot?.framing,
      ir.shot?.angle,
      ir.lighting?.key,
      ...(ir.lighting?.sources ?? []),
      ...(ir.lighting?.lookWords ?? []),
      ir.optics?.effect,
      profile.supports?.emitsGearNumbers ? ir.optics?.gearHint : undefined,
      ir.palette?.grade,
      ir.style?.medium,
      ir.style?.genre,
      ...(ir.style?.notes ?? []),
      ir.texture?.grain === 'fine-uniform' ? 'fine uniform film grain' : undefined,
    ]),
  );

  for (const t of ir.textInImage ?? []) {
    push('Text', ['textInImage'], `The text reads ${textClause(t)}`);
  }

  if (ir.texture?.skinBlock) {
    // Without this, models retouch skin to plastic wherever it is visible.
    segments.push({
      label: 'Skin',
      from: ['texture.skinBlock'],
      text: 'Natural skin texture: realistic pores, fine hairs, a faint highlight, tactile and not retouched.',
      source: 'template',
    });
  }

  const body = segments
    .filter((s) => s.label !== 'References')
    .map((s) => s.text.replace(/\.$/, ''))
    .join('. ');
  const text = `${refs ? `${refs} ` : ''}${capitalize(body)}.`;

  const params: Record<string, string> = {};
  if (ir.shot?.aspectRatio) params['aspect_ratio'] = ir.shot.aspectRatio;

  // Most of this line takes no negative field at all; the avoid list has to be
  // expressed positively or dropped rather than silently invented.
  const supportsNegative = profile.supports?.negativePrompt ?? false;
  const avoid = ir.constraints?.avoid ?? [];

  return supportsNegative && avoid.length > 0
    ? { target: profile.id, segments, text, negative: joinParts(avoid), params }
    : { target: profile.id, segments, text, params };
}
