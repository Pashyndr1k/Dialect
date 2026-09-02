/**
 * The shots of a sequence.
 *
 * A sequence is a world stated once and a list of differences from it. That is
 * the whole idea: the room, the light and who is in it are said in the document
 * feeding this node, and each shot says only what changes — which is what stops
 * a character drifting between cuts.
 *
 * So this edits differences, not documents. There is deliberately no field here
 * for anything the world already covers; if the light needs to change for one
 * shot, that shot says so and the rest inherit.
 */

import { SEAMS, type SequenceShot } from '@dialect/core';

export interface ShotsEditorProps {
  shots: SequenceShot[];
  onChange: (shots: SequenceShot[]) => void;
}

/** Ids are for the person, not the machine: they name a shot in a list. */
const nextId = (shots: SequenceShot[]): string => {
  for (let n = shots.length + 1; ; n += 1) {
    const id = `shot-${n}`;
    if (!shots.some((s) => s.id === id)) return id;
  }
};

export function ShotsEditor({ shots, onChange }: ShotsEditorProps): React.ReactElement {
  const patch = (i: number, next: Partial<SequenceShot>): void =>
    onChange(shots.map((s, at) => (at === i ? { ...s, ...next } : s)));

  return (
    <div className="shots">
      {shots.length === 0 ? (
        <p className="ins-empty">
          No shots yet. Each one says what changes from the document feeding this node.
        </p>
      ) : null}

      {shots.map((shot, i) => (
        <article key={shot.id} className="shot">
          <header>
            <b>{i + 1}</b>
            <input
              value={shot.id}
              onChange={(e) => patch(i, { id: e.target.value })}
              aria-label="name"
            />
            <button
              type="button"
              title={`Remove ${shot.id}`}
              onClick={() => onChange(shots.filter((_, at) => at !== i))}
            >
              ×
            </button>
          </header>

          <label>
            <span>Action</span>
            <textarea
              rows={2}
              value={shot.action ?? ''}
              placeholder="One thing happens. A second is what the next shot is for."
              onChange={(e) => patch(i, { action: e.target.value })}
            />
          </label>

          {/* Meaningless on the first shot: there is nothing before it to join. */}
          {i > 0 ? (
            <label>
              <span>Joins the one before by</span>
              <select
                value={shot.seam ?? ''}
                onChange={(e) =>
                  patch(i, { seam: (e.target.value || undefined) as SequenceShot['seam'] })
                }
              >
                <option value="">—</option>
                {SEAMS.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/-/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </article>
      ))}

      <button
        type="button"
        className="shot-add"
        onClick={() => onChange([...shots, { id: nextId(shots) }])}
      >
        Add a shot
      </button>
    </div>
  );
}
