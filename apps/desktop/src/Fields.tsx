import { fieldsForSegment, provenanceFor, setPath, type Leaf, type PromptIR } from '@dialect/core';
import type { Segment } from '@dialect/core';

/**
 * The fields behind one chip.
 *
 * This is what closes the loop on editing: a segment names the IR paths it was
 * built from, so clicking it opens those fields rather than asking anyone to
 * edit the finished prompt as text. Every edit goes back into the IR, which
 * recompiles — including for the other targets.
 */

const LABELS: Record<string, string> = {
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
  const m = /\[(\d+)\]\.([A-Za-z]+)$/.exec(leaf.path);
  const base = LABELS[leaf.key] ?? leaf.key;
  if (!m) return base;
  return `${Number.parseInt(m[1] ?? '0', 10) + 1} · ${base}`;
}

function group(leaf: Leaf): string {
  return leaf.path.split(/[.[]/)[0] ?? '';
}

export function Fields({
  ir,
  segment,
  onChange,
}: {
  ir: PromptIR;
  segment: Segment;
  onChange: (next: PromptIR) => void;
}) {
  const leaves = fieldsForSegment(ir, segment.from);

  const write = (leaf: Leaf, raw: string): void => {
    const value =
      leaf.kind === 'string[]'
        ? raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : leaf.kind === 'number'
          ? Number.parseFloat(raw)
          : raw;

    if (leaf.kind === 'number' && Number.isNaN(value as number)) return;
    onChange(setPath(ir, leaf.path, value));
  };

  if (leaves.length === 0) {
    return (
      <p className="quiet fields-empty">
        Nothing behind <strong>{segment.label}</strong> yet — it is built from{' '}
        <span className="mono">{segment.from.join(', ')}</span>.
      </p>
    );
  }

  return (
    <div className="fields">
      {leaves.map((leaf) => {
        const from = provenanceFor(ir, leaf.path);
        const text = leaf.kind === 'string[]' ? (leaf.value as string[]).join(', ') : String(leaf.value);
        const long = leaf.kind !== 'number' && leaf.kind !== 'boolean' && text.length > 80;

        return (
          <label key={leaf.path} className="fld">
            <span className="fld-k">
              {label(leaf)}
              {from ? <em className="src" title={`from ${from}`}>{from}</em> : null}
            </span>

            {leaf.kind === 'boolean' ? (
              <input
                type="checkbox"
                checked={leaf.value as boolean}
                onChange={(e) => onChange(setPath(ir, leaf.path, e.target.checked))}
              />
            ) : long ? (
              <textarea
                className="fld-v"
                rows={Math.min(8, Math.ceil(text.length / 70))}
                value={text}
                spellCheck={false}
                onChange={(e) => write(leaf, e.target.value)}
              />
            ) : (
              <input
                className="fld-v"
                value={text}
                spellCheck={false}
                onChange={(e) => write(leaf, e.target.value)}
              />
            )}

            <span className="fld-p mono">{leaf.path}</span>
          </label>
        );
      })}
      <p className="fields-note">
        Editing here rewrites the IR, so every target recompiles — not just{' '}
        {group(leaves[0]!)}.
      </p>
    </div>
  );
}
