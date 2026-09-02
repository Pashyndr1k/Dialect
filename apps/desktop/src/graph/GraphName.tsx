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
import { graphsFolder, openGraphFile, openGraphsFolder, saveGraphAs, type SavedGraph } from '../graphs.ts';

const UNTITLED = 'Untitled graph';

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
                  <button key={g.id} type="button" onClick={() => { setMenu(false); onOpen(g.doc); }}>
                    {g.doc.name ?? g.id}
                    <span>{g.doc.nodes.length} nodes</span>
                  </button>
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
            {/* The path is spelled out rather than hidden behind the verb,
                because the question people actually have is where the files
                are, not how to open a window onto them. */}
            <button type="button" onClick={() => act(openGraphsFolder)}>
              Show in the file manager
              <span className="doc-path">{where || 'Dialect’s graphs folder'}</span>
            </button>
          </div>
        </>
      ) : null}
    </span>
  );
}
