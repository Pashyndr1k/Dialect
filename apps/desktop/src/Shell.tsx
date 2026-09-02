/**
 * What the canvas sits inside.
 *
 * The chrome — the key, the budget, the libraries — was never part of the
 * pipeline, so it does not become nodes. It lives here, around whatever view is
 * showing. That split is the whole reason a node editor stays usable: everything
 * that is a step in making a prompt is a node, and everything that is a fact
 * about this machine is not.
 */

import { useEffect, useState } from 'react';
import type { Library, LoadedRegistry } from '@dialect/core';

import { Editor } from './graph/Editor.tsx';
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
import type { GraphDoc } from '@dialect/core';

export function Shell(): React.ReactElement {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [registry, setRegistry] = useState<LoadedRegistry>(BUILTIN);
  const [library, setLibrary] = useState<Library | null>(null);
  const [opening, setOpening] = useState<GraphDoc | null>(null);

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

  return (
    <div className="shell">
      <header className="shell-head">
        <h1>
          Dialect <span className="version">{__APP_VERSION__}</span>
        </h1>
        <span className="spacer" />
        <button type="button" className="ghost" onClick={() => setShelfOpen(true)}>
          Kept
        </button>
        <button type="button" className="ghost" onClick={() => setCardsOpen(true)}>
          Cards
        </button>
        <button type="button" className="ghost" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </header>

      {library && opening ? (
        <Editor registry={registry} library={library} doc={opening} />
      ) : (
        <p className="shell-loading">Reading the cards and templates…</p>
      )}

      {cardsOpen ? (
        <Cards
          rejected={registry.rejected}
          cardCount={registry.registry.profiles.size}
          onChanged={() => void loadRegistry().then(setRegistry).catch(() => undefined)}
          onClose={() => setCardsOpen(false)}
        />
      ) : null}

      {shelfOpen ? (
        <Shelf
          onClose={() => setShelfOpen(false)}
          onChanged={() => void listTemplates().then((t) => setLibrary(libraryWith(t)))}
        />
      ) : null}

      {settingsOpen ? <Settings onClose={() => setSettingsOpen(false)} /> : null}

      <Update />
    </div>
  );
}
