/**
 * The name of the graph you are working on, in the title bar.
 *
 * A document's name belongs beside the application's name — that is where
 * everything else with documents puts it, and it is the only place you can see
 * at a glance which of your graphs is open. Before this the name existed and
 * was never shown, so every saved graph was called "graph".
 *
 * Editable in place: click it, type, press Enter. Saving is next to it because
 * naming and keeping are the same thought.
 */

import { useEffect, useRef, useState } from 'react';

export interface GraphNameProps {
  name: string | undefined;
  dirty: boolean;
  onRename: (name: string) => void;
  onSave: (name: string) => void;
}

const UNTITLED = 'Untitled graph';

export function GraphName({ name, dirty, onRename, onSave }: GraphNameProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? '');
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(name ?? ''), [name]);
  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);

  const commit = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    else setDraft(name ?? '');
  };

  if (editing) {
    return (
      <input
        ref={field}
        className="graph-name-edit"
        value={draft}
        placeholder={UNTITLED}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          // Escape puts back what was there. An edit you did not mean to make
          // should cost one key, not a retype.
          if (e.key === 'Escape') {
            setDraft(name ?? '');
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <span className="graph-name">
      <button
        type="button"
        className="graph-name-show"
        title="Rename this graph"
        onClick={() => setEditing(true)}
      >
        {name?.trim() || UNTITLED}
        {/* A dot, not the word "unsaved": it is a reminder, not a warning. */}
        {dirty ? <i className="graph-dirty" title="Not saved since the last change" /> : null}
      </button>
      <button
        type="button"
        className="btn ghost"
        onClick={() => {
          const next = (name ?? '').trim();
          // Nothing is saved as "Untitled". If it has no name yet, ask for one
          // here rather than filing something nobody can find again.
          if (!next) setEditing(true);
          else onSave(next);
        }}
      >
        Save
      </button>
    </span>
  );
}
