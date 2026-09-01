/**
 * What the canvas sits inside.
 *
 * The chrome — the key, the budget, the libraries — was never part of the
 * pipeline, so it does not become nodes. It lives here, around whatever view is
 * showing. That split is the whole reason a node editor stays usable: everything
 * that is a step in making a prompt is a node, and everything that is a fact
 * about this machine is not.
 *
 * The panels are still reachable while the canvas is being built. That toggle
 * goes when the canvas covers everything the panels do — not before, because
 * the way to lose work is to delete the road before the bridge is finished.
 */

import { useEffect, useState } from 'react';
import type { GraphDoc, Library, LoadedRegistry } from '@dialect/core';

import { App } from './App.tsx';
import { Editor } from './graph/Editor.tsx';
import { Settings } from './Settings.tsx';
import { BUILTIN } from './registry.ts';
import { loadRegistry } from './channel.ts';
import { builtinLibrary, libraryWith, listTemplates } from './templates.ts';
import imageExample from './example.image.json';

type View = 'canvas' | 'panels';

/**
 * What the canvas opens on.
 *
 * An empty canvas is a bad first thing to be handed: it asks you to know the
 * vocabulary before you have seen any of it. This is the shortest graph that
 * does something real — a document, and a model to render it in — so the first
 * press of Run produces a prompt and costs nothing.
 */
const STARTER: GraphDoc = {
  version: 1,
  name: 'A document, rendered',
  nodes: [
    {
      id: 'document-1',
      type: 'document',
      at: { x: 40, y: 60 },
      params: { json: JSON.stringify(imageExample, null, 2) },
    },
    { id: 'compile-1', type: 'compile', at: { x: 340, y: 60 }, params: { target: 'nano-banana-2' } },
  ],
  edges: [{ from: { node: 'document-1', port: 'out' }, to: { node: 'compile-1', port: 'ir' } }],
};

export function Shell(): React.ReactElement {
  const [view, setView] = useState<View>('canvas');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [registry, setRegistry] = useState<LoadedRegistry>(BUILTIN);
  const [library, setLibrary] = useState<Library | null>(null);

  useEffect(() => {
    // Cards and templates are read from disk, so the first paint uses what the
    // build shipped and this replaces it a moment later.
    void (async () => {
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

  if (view === 'panels') {
    return (
      <>
        <button type="button" className="view-toggle" onClick={() => setView('canvas')}>
          Canvas
        </button>
        <App />
      </>
    );
  }

  return (
    <div className="shell">
      <header className="shell-head">
        <h1>
          Dialect <span className="version">{__APP_VERSION__}</span>
        </h1>
        <span className="spacer" />
        <button type="button" className="ghost" onClick={() => setView('panels')}>
          Panels
        </button>
        <button type="button" className="ghost" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </header>

      {library ? (
        <Editor registry={registry} library={library} doc={STARTER} />
      ) : (
        <p className="shell-loading">Reading the cards and templates…</p>
      )}

      {settingsOpen ? <Settings onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
