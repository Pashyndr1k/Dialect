/**
 * Editing the document, one field at a time.
 *
 * The panels reached this by clicking a block of the finished prompt: a block
 * names the paths it was built from, so clicking it opened those fields rather
 * than asking anyone to edit rendered text. That loop is the point — an edit
 * goes back into the document and recompiles, including for the other targets.
 *
 * On a canvas the same loop runs through an Edit fields node. What is shown is
 * the document that came *out* of it, and an edit is recorded as an override on
 * the node, so the change is part of the graph and survives being saved rather
 * than living in a panel nobody can see.
 */

import { leavesUnder, type Leaf, type PromptIR } from '@dialect/core';

/** Where the interesting things are. Deep enough to reach a face, no deeper. */
const BRANCHES = [
  'title',
  'subject',
  'environment',
  'shot',
  'lighting',
  'optics',
  'texture',
  'palette',
  'style',
  'mood',
  'constraints',
];

const NICE: Record<string, string> = {
  headline: 'headline',
  description: 'description',
  action: 'action',
  key: 'key light',
  sources: 'other sources',
  colorTemp: 'colour temperature',
  timeOfDay: 'time of day',
  aspectRatio: 'aspect ratio',
  durationS: 'duration (s)',
  lookWords: 'look words',
  gearHint: 'lens (shorthand)',
  effect: 'visible effect',
  skinBlock: 'skin realism block',
  atmosphere: 'atmosphere',
  avoid: 'avoid',
};

/** `subject.entities[1].description` reads better as `entities 2 · description`. */
function label(leaf: Leaf): string {
  // Dropping the first step removes the branch, which the reader can already
  // see. A top-level field like `title` has nothing but that step, so it keeps
  // it rather than ending up with no label at all.
  const steps = leaf.path.split('.');
  const parts = steps.length > 1 ? steps.slice(1) : steps;
  return parts
    .map((p) => {
      const m = /^(.*)\[(\d+)\]$/.exec(p);
      if (m) return `${NICE[m[1]!] ?? m[1]} ${Number(m[2]) + 1}`;
      return NICE[p] ?? p;
    })
    .join(' · ');
}

export interface FieldEditorProps {
  ir: PromptIR;
  /** Overrides already on the node, so an edited field shows its edited value. */
  set: Record<string, unknown>;
  onSet: (path: string, value: unknown) => void;
}

export function FieldEditor({ ir, set, onSet }: FieldEditorProps): React.ReactElement {
  const leaves = BRANCHES.flatMap((b) => leavesUnder(ir, b));

  if (leaves.length === 0) {
    return <p className="ins-empty">Nothing to edit until this node has run.</p>;
  }

  return (
    <div className="fields">
      {leaves.map((leaf) => {
        const overridden = Object.hasOwn(set, leaf.path);
        const value = overridden ? set[leaf.path] : leaf.value;

        return (
          <label key={leaf.path} className={overridden ? 'field field-set' : 'field'}>
            <span title={leaf.path}>{label(leaf)}</span>

            {leaf.kind === 'boolean' ? (
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => onSet(leaf.path, e.target.checked)}
              />
            ) : leaf.kind === 'number' ? (
              <input
                type="number"
                value={typeof value === 'number' ? value : 0}
                onChange={(e) => onSet(leaf.path, Number(e.target.value))}
              />
            ) : leaf.kind === 'string[]' ? (
              <textarea
                rows={2}
                value={Array.isArray(value) ? value.join('\n') : String(value ?? '')}
                // One per line rather than comma-separated: half these values
                // are phrases with commas in them.
                onChange={(e) =>
                  onSet(
                    leaf.path,
                    e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                  )
                }
              />
            ) : (
              <textarea
                rows={String(value ?? '').length > 60 ? 3 : 1}
                value={String(value ?? '')}
                onChange={(e) => onSet(leaf.path, e.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
