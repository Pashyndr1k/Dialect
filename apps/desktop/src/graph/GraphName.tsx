/**
 * The graph you are working on: its name, and everything you do to it as a
 * document.
 *
 * All of it in the title bar, because that is where a document's name and its
 * File menu live in every other program, and looking anywhere else is a thing
 * you should not have to learn. Opening used to be in a shelf called "Kept" and
 * saving-as did not exist at all, which meant the honest answer to "where do I
 * load a graph" was "somewhere you would never look".
 */

import { useEffect, useRef, useState } from 'react';
import type { GraphDoc } from '@dialect/core';

import { EXAMPLES } from './examples.ts';
import {
  deleteGraph,
  graphsFolder,
  openGraphFile,
  openGraphsFolder,
  saveGraphAs,
  type SavedGraph,
} from '../graphs.ts';

const UNTITLED = 'Untitled graph';

/** A bin, drawn rather than typed, so it is the same size as every other icon. */
function TrashIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.6 9h5.8l.6-9M6.8 6.3v4.4M9.2 6.3v4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface GraphNameProps {
  name: string | undefined;
  dirty: boolean;
  doc: GraphDoc;
  saved: SavedGraph[];
  onRename: (name: string) => void;
  onSave: (name: string) => void;
  onOpen: (doc: GraphDoc) => void;
  onNew: () => void;
  onSay: (message: string) => void;
  /** So the list reloads after one is removed. */
  onDeleted: () => void;
}

export function GraphName({
  name,
  dirty,
  doc,
  saved,
  onRename,
  onSave,
  onOpen,
  onNew,
  onSay,
  onDeleted,
}: GraphNameProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [where, setWhere] = useState('');
  const [draft, setDraft] = useState(name ?? '');
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(name ?? ''), [name]);
  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);

  // Only asked for when the menu opens: it is a round trip to the host and
  // nobody needs the answer until they are looking for it.
  useEffect(() => {
    if (menu && !where) void graphsFolder().then(setWhere).catch(() => setWhere(''));
  }, [menu, where]);

  const commit = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    else setDraft(name ?? '');
  };

  const act = (what: () => Promise<unknown>): void => {
    setMenu(false);
    void what().catch((err: Error) => onSay(err.message));
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
        {/* A dot, not the word "unsaved": a reminder, not a warning. */}
        {dirty ? <i className="graph-dirty" title="Not saved since the last change" /> : null}
      </button>

      <button
        type="button"
        className="btn ghost graph-menu-open"
        title="New, open, save"
        onClick={() => setMenu((m) => !m)}
      >
        Graph ▾
      </button>

      {menu ? (
        <>
          <div className="menu-shade" onClick={() => setMenu(false)} />
          <div className="doc-menu">
            <button type="button" onClick={() => { setMenu(false); onNew(); }}>
              New
            </button>
            <button
              type="button"
              onClick={() =>
                act(async () => {
                  const found = await openGraphFile();
                  if (found) onOpen(found.doc);
                })
              }
            >
              Open a file…
            </button>

            <hr />

            <button
              type="button"
              onClick={() => {
                setMenu(false);
                const next = (name ?? '').trim();
                // Nothing is filed as "Untitled": without a name it asks for
                // one rather than saving something nobody can find again.
                if (!next) setEditing(true);
                else onSave(next);
              }}
            >
              Save
              <span>to Dialect’s own folder</span>
            </button>
            <button type="button" onClick={() => act(async () => {
              const path = await saveGraphAs(doc);
              if (path) onSay(`Saved to ${path}`);
            })}>
              Save as…
              <span>anywhere you like</span>
            </button>

            {saved.length > 0 ? (
              <>
                <hr />
                <h4>Saved</h4>
                {saved.map((g) => (
                  <div key={g.id} className="doc-row">
                    <button type="button" onClick={() => { setMenu(false); onOpen(g.doc); }}>
                      {g.doc.name ?? g.id}
                      <span>{g.doc.nodes.length} nodes</span>
                    </button>
                    {/* Asked about, because a graph is work and a mis-aimed
                        click in a list is how work disappears. */}
                    <button
                      type="button"
                      className="doc-drop"
                      title={`Delete ${g.doc.name ?? g.id}`}
                      aria-label={`Delete ${g.doc.name ?? g.id}`}
                      onClick={() => {
                        if (!confirm(`Delete “${g.doc.name ?? g.id}”? This cannot be undone.`)) return;
                        // The menu stays open: you came here to tidy up, and
                        // reopening it for each one would be its own annoyance.
                        void deleteGraph(g.id)
                          .then(onDeleted)
                          .catch((err: Error) => {
                            setMenu(false);
                            onSay(err.message);
                          });
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
              </>
            ) : null}

            <hr />
            <h4>Examples</h4>
            {EXAMPLES.map((ex) => (
              <button key={ex.id} type="button" onClick={() => { setMenu(false); onOpen(ex.doc); }}>
                {ex.doc.name ?? ex.id}
                <span>
                  {ex.doc.nodes.length} nodes · {ex.about}
                </span>
              </button>
            ))}

            <hr />
            <button type="button" onClick={() => act(openGraphsFolder)}>
              Show in the file manager
            </button>
            {/* Not part of the button. It is the answer to "where are my
                files", which is a thing to read, and a line of text that
                highlights under the cursor and does nothing when clicked is a
                broken button as far as anyone can tell. */}
            <p className="doc-path">{where || 'Dialect’s graphs folder'}</p>
          </div>
        </>
      ) : null}
    </span>
  );
}
