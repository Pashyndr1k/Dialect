/**
 * What you can do with what a node made.
 *
 * These are not nodes. Copying a prompt, keeping a reading, filing a learned
 * template — none of them is a step in making a prompt, they are things done to
 * a result afterwards. Putting them on the canvas would mean wiring a node in
 * order to press a button.
 *
 * They live beside the result instead, in the inspector, and what is offered
 * depends on what the selected node produced.
 */

import { useState } from 'react';
import {
  promptFileName,
  sourceId,
  templateToYaml,
  type SavedSource,
  type Value,
} from '@dialect/core';

import { listSources, saveSource } from '../sources.ts';
import { listTemplates, saveTemplate } from '../templates.ts';
import { savePromptsTo } from '../store.ts';

/** Short-lived word under the buttons: what just happened, in one line. */
type Said = { text: string; bad?: boolean } | null;

export function Actions({ values }: { values: readonly Value[] }): React.ReactElement | null {
  const [said, setSaid] = useState<Said>(null);

  if (values.length === 0) return null;
  const kind = values[0]!.type;

  const report = (text: string, bad = false): void => {
    setSaid({ text, ...(bad ? { bad } : {}) });
    // Long enough to read, short enough not to become part of the furniture.
    setTimeout(() => setSaid(null), 4000);
  };

  const run = (what: () => Promise<string>): void => {
    void what()
      .then(report)
      .catch((err: Error) => report(err.message, true));
  };

  const buttons: Array<{ label: string; go: () => void }> = [];

  if (kind === 'prompt') {
    const prompts = values.flatMap((v) => (v.type === 'prompt' ? [v.prompt] : []));

    buttons.push({
      label: prompts.length > 1 ? `Copy all ${prompts.length}` : 'Copy',
      go: () =>
        run(async () => {
          // Blank line between them: several prompts pasted into one document
          // have to stay separable by eye.
          await navigator.clipboard.writeText(prompts.map((p) => p.render.text).join('\n\n'));
          return prompts.length > 1 ? `${prompts.length} prompts copied` : 'Copied';
        }),
    });

    buttons.push({
      label: prompts.length > 1 ? 'Save all' : 'Save',
      go: () =>
        run(async () => {
          // A set saved together must not overwrite itself: one document
          // rendered for three models is three prompts with one title.
          const taken = new Set<string>();
          const where = await savePromptsTo(
            prompts.map((p, i) => ({
              name: promptFileName(p, i + 1, taken),
              contents: p.render.text,
            })),
          );
          // Cancelling is not a failure, and saying "saved" would be a lie.
          return where ? `Saved to ${where}` : 'Not saved';
        }),
    });
  }

  if (kind === 'ir') {
    const irs = values.flatMap((v) => (v.type === 'ir' ? [v.ir] : []));
    buttons.push({
      label: irs.length > 1 ? `Copy all ${irs.length}` : 'Copy document',
      go: () =>
        run(async () => {
          await navigator.clipboard.writeText(
            JSON.stringify(irs.length === 1 ? irs[0] : irs, null, 2),
          );
          return 'Copied';
        }),
    });
  }

  if (kind === 'lines') {
    const readings = values.flatMap((v) => (v.type === 'lines' ? [v.lines] : []));
    buttons.push({
      label: readings.length > 1 ? `Keep all ${readings.length}` : 'Keep it',
      go: () =>
        run(async () => {
          // A reading kept is the reading bought once and attached for nothing
          // afterwards. Ids are made against what is already there so keeping
          // the same file twice does not make two entries.
          const taken = (await listSources()).map((s) => s.id);
          for (const r of readings) {
            const id = sourceId(r.id, taken);
            taken.push(id);
            const saved: SavedSource = {
              id,
              name: r.id,
              kind: r.kind,
              role: r.role,
              lines: r.lines,
              savedAt: new Date().toISOString(),
            };
            await saveSource(saved);
          }
          return readings.length > 1
            ? `${readings.length} into Memory`
            : 'Into Memory';
        }),
    });
  }

  if (kind === 'template') {
    const templates = values.flatMap((v) => (v.type === 'template' ? [v.template] : []));
    buttons.push({
      label: 'Add to templates',
      go: () =>
        run(async () => {
          const taken = new Set((await listTemplates()).map((t) => t.id));
          for (const t of templates) {
            // A learned template arrives with the name the model proposed, and
            // two goes at the same example would otherwise overwrite the first.
            let id = t.id;
            for (let n = 2; taken.has(id); n += 1) id = `${t.id}-${n}`;
            taken.add(id);
            await saveTemplate(id, templateToYaml({ ...t, id }));
          }
          return templates.length > 1 ? `Filed ${templates.length}` : 'Filed';
        }),
    });
  }

  if (buttons.length === 0) return null;

  return (
    <div className="ins-actions">
      {buttons.map((b) => (
        <button key={b.label} type="button" onClick={b.go}>
          {b.label}
        </button>
      ))}
      {said ? <span className={said.bad ? 'said bad' : 'said'}>{said.text}</span> : null}
    </div>
  );
}
