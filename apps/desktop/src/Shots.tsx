import {
  CAMERA_MOVES,
  SEAMS,
  SHOT_SIZES,
  addShot,
  removeShot,
  updateShot,
  type CompiledSequence,
  type Sequence,
  type SequenceShot,
} from '@dialect/core';

/**
 * A sequence, in the right pane, because a sequence is prompt work.
 *
 * The shape of this panel follows the shape of the data on purpose: the world
 * is stated once, up in the document, and each row here is only what makes one
 * shot different from it. There is nowhere to retype the character, which is
 * the point — a character retyped is a character that drifts.
 */

const SIZE_LABEL: Record<string, string> = {
  'extreme-wide': 'extreme wide',
  'medium-wide': 'medium wide',
  'medium-close': 'medium close',
  'close-up': 'close-up',
  'extreme-close-up': 'extreme close-up',
  'two-shot': 'two-shot',
  'over-shoulder': 'over-shoulder',
};

const SEAM_LABEL: Record<string, string> = {
  'frozen-handoff': 'frozen hand-off',
  'action-bridge': 'action bridge',
  'match-cut': 'match cut',
  portal: 'portal',
  'hard-cut': 'hard cut',
};

const pretty = (value: string, labels: Record<string, string>): string =>
  labels[value] ?? value;

export function Shots({
  sequence,
  compiled,
  selected,
  saved,
  onSelect,
  onChange,
  onClear,
  onCopyAll,
  onSaveAll,
}: {
  sequence: Sequence;
  compiled: CompiledSequence;
  selected: string | null;
  saved: string | null;
  onSelect: (id: string | null) => void;
  onChange: (next: Sequence) => void;
  onClear: () => void;
  onCopyAll: () => void;
  onSaveAll: () => void;
}) {
  const write = (id: string, change: Partial<SequenceShot>): void =>
    onChange(updateShot(sequence, id, change));

  const open = compiled.shots.find((s) => s.id === selected);

  return (
    <div className="block seq">
      <div className="seq-h">
        <h3>
          Shots
          <span className="count">{sequence.shots.length}</span>
          {compiled.runtimeS > 0 ? (
            <span className="seq-run">{compiled.runtimeS}s</span>
          ) : null}
        </h3>

        <div className="seq-b">
          <button className="ghost" onClick={() => onChange(addShot(sequence))}>
            Add shot
          </button>
          <button className="ghost" onClick={onCopyAll}>
            Copy all
          </button>
          <button className="ghost" onClick={onSaveAll}>
            Save all
          </button>
          <button className="ghost" title="Go back to one prompt" onClick={onClear}>
            Close
          </button>
        </div>
      </div>

      <p className="quiet seq-note">
        The world above is shared by every shot. Each row is only what changes.
        {saved ? <span className="seq-saved"> Saved to {saved}</span> : null}
      </p>

      {compiled.continuity.length > 0 ? (
        <ul className="findings seq-cont">
          {compiled.continuity.map((f, i) => (
            <li key={`${f.ruleId}-${i}`} className={f.level}>
              <span className="lvl">{f.level}</span>
              <div>
                <p className="msg">{f.message}</p>
                {f.fix ? <p className="fix">{f.fix}</p> : null}
                <p className="rid">{f.ruleId}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="rows-s">
        {sequence.shots.map((shot, i) => {
          const result = compiled.shots[i];
          const trouble = result?.blocked ?? false;

          return (
            <li key={shot.id} className={`row-s${selected === shot.id ? ' sel' : ''}${trouble ? ' bad' : ''}`}>
              <div className="row-s-top">
                <button
                  className="row-s-id"
                  title="Show this shot's prompt"
                  onClick={() => onSelect(selected === shot.id ? null : shot.id)}
                >
                  {shot.id}
                </button>

                {/* An extracted action can be a paragraph; a typed one is a
                    line. One control that grows fits both without a mode. */}
                <textarea
                  className="row-s-act"
                  rows={Math.min(5, Math.ceil(((shot.action ?? '').length + 1) / 60))}
                  placeholder="what happens in this shot"
                  spellCheck={false}
                  value={shot.action ?? ''}
                  onChange={(e) => write(shot.id, { action: e.target.value })}
                />

                <button
                  className="row-s-x"
                  title="Remove this shot"
                  aria-label={`Remove ${shot.id}`}
                  disabled={sequence.shots.length === 1}
                  onClick={() => {
                    if (selected === shot.id) onSelect(null);
                    onChange(removeShot(sequence, shot.id));
                  }}
                >
                  {'×'}
                </button>
              </div>

              <div className="row-s-set">
                <select
                  value={shot.shot?.size ?? ''}
                  title="Shot size"
                  onChange={(e) =>
                    write(shot.id, {
                      shot: { ...shot.shot, ...(e.target.value ? { size: e.target.value as never } : {}) },
                    })
                  }
                >
                  <option value="">size</option>
                  {SHOT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {pretty(s, SIZE_LABEL)}
                    </option>
                  ))}
                </select>

                <select
                  value={shot.cameraMove?.move ?? ''}
                  title="Camera move"
                  onChange={(e) =>
                    write(shot.id, {
                      ...(e.target.value
                        ? { cameraMove: { ...shot.cameraMove, move: e.target.value as never } }
                        : {}),
                    })
                  }
                >
                  <option value="">camera</option>
                  {CAMERA_MOVES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>

                <input
                  className="row-s-dur"
                  type="number"
                  min={1}
                  step={1}
                  title="Seconds"
                  placeholder="s"
                  value={shot.shot?.durationS ?? ''}
                  onChange={(e) => {
                    const n = Number.parseFloat(e.target.value);
                    write(shot.id, {
                      shot: { ...shot.shot, ...(Number.isFinite(n) ? { durationS: n } : {}) },
                    });
                  }}
                />

                {i > 0 ? (
                  <>
                    <select
                      value={shot.seam ?? ''}
                      title="How this shot joins the one before it"
                      onChange={(e) =>
                        write(shot.id, {
                          ...(e.target.value ? { seam: e.target.value as never } : {}),
                        })
                      }
                    >
                      <option value="">seam</option>
                      {SEAMS.map((s) => (
                        <option key={s} value={s}>
                          {pretty(s, SEAM_LABEL)}
                        </option>
                      ))}
                    </select>

                    <label
                      className="row-s-fr"
                      title="Feed the previous shot's last frame in as this one's start frame"
                    >
                      <input
                        type="checkbox"
                        checked={shot.continuesFromFrame ?? false}
                        onChange={(e) => write(shot.id, { continuesFromFrame: e.target.checked })}
                      />
                      from frame
                    </label>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {open ? (
        <div className="seq-open">
          <h3>
            {open.id}
            <span className="pane-of">
              {sequence.shots[open.index]?.continuesFromFrame
                ? 'starts from the previous frame'
                : 'cut cold'}
            </span>
          </h3>
          <pre className="out">{open.render.text}</pre>

          {open.findings.length > 0 ? (
            <ul className="findings">
              {open.findings.map((f, i) => (
                <li key={`${f.ruleId}-${i}`} className={f.level}>
                  <span className="lvl">{f.level}</span>
                  <div>
                    <p className="msg">{f.message}</p>
                    {f.fix ? <p className="fix">{f.fix}</p> : null}
                    <p className="rid">{f.ruleId}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
