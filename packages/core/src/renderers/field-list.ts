/**
 * The `field-list` form: labelled fields in a mandatory order, nothing skipped.
 *
 * The renderer holds no knowledge of any particular dialect. Which fields exist,
 * what feeds each one and how the parts are joined all come from the profile —
 * so Kling's nine-field formula is an editable card, not a function in here.
 * This file only orders, labels and joins.
 */

import type { PromptIR } from '../ir/types.ts';
import type { ModelProfile } from '../registry/types.ts';
import type { RenderResult, Segment } from './types.ts';
import { RendererError, assembleText } from './types.ts';
import { resolveField } from './resolve.ts';

const ID = 'field-list';

export function renderFieldList(ir: PromptIR, profile: ModelProfile): RenderResult {
  const fields = profile.fields;
  if (!fields || fields.length === 0) {
    throw new RendererError(
      ID,
      `profile "${profile.id}" lists no fields, so there is nothing to render. ` +
        `A field-list profile needs a "fields" block naming each field and what feeds it.`,
    );
  }

  const segments: Segment[] = [];
  let negative: string | undefined;

  for (const spec of fields) {
    const text = resolveField(ir, spec, profile);

    if (spec.role === 'negative') {
      // Negative travels separately so the UI can show it in its own panel.
      if (text) negative = text;
      continue;
    }
    segments.push({ label: spec.name, from: spec.from, text, source: 'ir' });
  }

  // How the fields become one prompt is the card's business: Kling wants a
  // labelled field per line, a music model wants one comma-separated line.
  const assembly = {
    separator: profile.assembly?.separator ?? '\n\n',
    labelled: profile.assembly?.labelled ?? true,
  };
  const text = assembleText({ segments, assembly });

  const params: Record<string, string> = {};
  if (ir.shot?.aspectRatio) params['aspect_ratio'] = ir.shot.aspectRatio;
  if (ir.shot?.durationS !== undefined) {
    params['duration'] = `${ir.shot.durationS} ${ir.shot.durationS === 1 ? 'second' : 'seconds'}`;
  }

  return negative === undefined
    ? { target: profile.id, segments, text, assembly, params }
    : { target: profile.id, segments, text, assembly, negative, params };
}
