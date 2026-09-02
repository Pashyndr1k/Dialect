/**
 * What the canvas sits inside.
 *
 * The chrome — the key, the budget, the libraries — was never part of the
 * pipeline, so it does not become nodes. It lives here, around the canvas.
 * That split is the whole reason a node editor stays usable: everything that
 * is a step in making a prompt is a node, and everything that is a fact about
 * this machine is not.
 *
 * The title bar reads left to right as: what this is, what you are working on,
 * and what you keep. Which document you have open belongs beside the
 * application's name — that is where every other program with documents puts
 * it, and before this the graph had a name that was never shown anywhere.
 */

import { useCallback, useEffect, useState } from 'react';
import type { GraphDoc, Library, LoadedRegistry } from '@dialect/core';

import { Editor } from './graph/Editor.tsx';
import { GraphName } from './graph/GraphName.tsx';
import { Settings } from './Settings.tsx';
import { Cards } from './Cards.tsx';
import { Shelf } from './Shelf.tsx';
import { Update } from './Update.tsx';
import { BUILTIN } from './registry.ts';
import { restoreSpend } from './gateway.ts';
import { loadRegistry } from './channel.ts';
import { builtinLibrary, libraryWith, listTemplates } from './templates.ts';
import { STARTER_GRAPH } from './graph/examples.ts';
import { loadOpenGraph } from './graph/open.ts';
import type { SavedGraph } from './graphs.ts';

/** What the editor hands up so the title bar can name and keep the graph. */
interface GraphHandles {
  name: string | undefined;
  dirty: boolean;
  doc: GraphDoc;
  rename: (name: string) => void;
  save: () => void;
  open: (doc: GraphDoc) => void;
  saved: SavedGraph[];
  say: (message: string) => void;
}

/** A graph with nothing in it, for New. */
const BLANK: GraphDoc = { version: 1, nodes: [], edges: [] };

export function Shell(): React.ReactElement {
  const [sheet, setSheet] = useState<'kept' | 'cards' | 'settings' | null>(null);
  const [registry, setRegistry] = useState<LoadedRegistry>(BUILTIN);
  const [library, setLibrary] = useState<Library | null>(null);
  const [opening, setOpening] = useState<GraphDoc | null>(null);
  const [graph, setGraph] = useState<GraphHandles | null>(null);

  useEffect(() => {
    // Cards and templates are read from disk, so the first paint uses what the
    // build shipped and this replaces it a moment later.
    void (async () => {
      // What earlier sessions spent, before anything can be run.
      await restoreSpend();
      // Where the last window was left, or the starter graph the first time.
      setOpening((await loadOpenGraph()) ?? STARTER_GRAPH);
      try {
        setRegistry(await loadRegistry());
      } catch {
        /* The built-in cards are a working registry; a failed layer is not fatal. */
      }
      try {
        setLibrary(libraryWith(await listTemplates()));
      } catch {
        setLibrary(builtinLibrary);
      }
    })();
  }, []);

  const onGraph = useCallback((state: GraphHandles) => setGraph(state), []);

  return (
    <div className="shell">
      <header className="shell-head">
        <h1>
          Dialect <span className="version">{__APP_VERSION__}</span>
        </h1>

        <span className="shell-sep" />

        {graph ? (
          <GraphName
            name={graph.name}
            dirty={graph.dirty}
            doc={graph.doc}
            saved={graph.saved}
            onRename={graph.rename}
            onSave={(name) => {
              graph.rename(name);
              // The rename has to land before the save reads it.
              setTimeout(graph.save, 0);
            }}
            onOpen={graph.open}
            onNew={() => graph.open({ ...BLANK, name: undefined })}
            onSay={graph.say}
          />
        ) : null}

        <span className="spacer" />

        <button type="button" className="btn ghost" onClick={() => setSheet('kept')}>
          Kept
        </button>
        <button type="button" className="btn ghost" onClick={() => setSheet('cards')}>
          Models
        </button>
        <button type="button" className="btn ghost" onClick={() => setSheet('settings')}>
          Settings
        </button>
      </header>

      {library && opening ? (
        <Editor registry={registry} library={library} doc={opening} onGraph={onGraph} />
      ) : (
        <p className="shell-loading">Reading the cards and templates…</p>
      )}

      {sheet === 'cards' ? (
        <Cards
          registry={registry}
          onChanged={() => void loadRegistry().then(setRegistry).catch(() => undefined)}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'kept' ? (
        <Shelf
          onClose={() => setSheet(null)}
          onChanged={() => void listTemplates().then((t) => setLibrary(libraryWith(t)))}
          onOpenGraph={(doc) => graph?.open(doc)}
        />
      ) : null}

      {sheet === 'settings' ? <Settings onClose={() => setSheet(null)} /> : null}

      <Update />
    </div>
  );
}
