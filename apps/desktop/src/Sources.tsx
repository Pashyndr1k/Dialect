import { ROLE_LABEL, SOURCE_ROLES, type SavedSource, type SourceRole } from '@dialect/core';

/**
 * Things kept, so they cost nothing the second time.
 *
 * A character read out of one photograph is text afterwards. Keeping that text
 * means the same person can appear in fifty prompts without the photograph
 * being looked at again — which is the whole payoff of reading and composing
 * being two passes rather than one.
 *
 * A cast member and a look are the same object here, distinguished only by
 * what they are for. That is not a simplification of the plan; it is what the
 * plan turned out to be once sources had jobs.
 */
export function Sources({
  sources,
  attached,
  onAttach,
  onRole,
  onDelete,
  onOpenFolder,
  onClose,
}: {
  sources: SavedSource[];
  /** Ids already in the composer, so it says so rather than adding twice. */
  attached: string[];
  onAttach: (source: SavedSource) => void;
  onRole: (id: string, role: SourceRole) => void;
  onDelete: (id: string) => void;
  onOpenFolder: () => void;
  onClose: () => void;
}) {
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-box wide" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <h2>Kept</h2>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="sheet-p">
          Characters, looks, places — anything read once. Attaching one costs nothing: what it
          says was paid for when it was read.
        </p>

        {sources.length === 0 ? (
          <p className="quiet">
            Nothing kept yet. Read a reference, then press Keep on it.
          </p>
        ) : (
          <ul className="kept">
            {sources.map((s) => (
              <li key={s.id}>
                {s.thumb ? <img src={s.thumb} alt="" /> : <span className="kept-none" />}

                <div className="kept-mid">
                  <span className="tpl-v">{s.name}</span>
                  <span className="tpl-h">{s.lines[0] ?? ''}</span>
                  <span className="kept-meta">
                    {s.lines.length} lines · {s.from ?? s.kind} · {s.savedAt}
                  </span>
                </div>

                <select
                  className="ref-r"
                  value={s.role}
                  aria-label={`What ${s.name} is for`}
                  onChange={(e) => onRole(s.id, e.target.value as SourceRole)}
                >
                  {SOURCE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>

                <button
                  className="ghost"
                  disabled={attached.includes(s.id)}
                  onClick={() => onAttach(s)}
                >
                  {attached.includes(s.id) ? 'Attached' : 'Attach'}
                </button>

                <button
                  className="row-s-x"
                  title={`Forget ${s.name}`}
                  aria-label={`Forget ${s.name}`}
                  onClick={() => onDelete(s.id)}
                >
                  {'×'}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="sheet-p dim">
          They are files, so a description can be fixed in any editor.{' '}
          <button className="link" onClick={onOpenFolder}>
            Open the folder
          </button>
        </p>
      </div>
    </div>
  );
}
