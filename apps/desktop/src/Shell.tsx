/**
 * What the canvas sits inside.
 *
 * The chrome — the key, the budget, the libraries — was never part of the
 * pipeline, so it does not become nodes. It lives here, around the canvas. That
 * split is the whole reason a node editor stays usable: everything that is a
 * step in making a prompt is a node, and everything that is a fact about this
 * machine is not.
 *
 * It also holds the open tabs, because a tab has to outlive the editor showing
 * it. Only the active graph is mounted — React Flow measures what is on screen,
 * and a hidden canvas measures as nothing, which is how every node in this app
 * became invisible once already. So the tab you switch away from hands its
 * whole state up here and is rebuilt from it when you come back.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GraphDoc, Library, LoadedRegistry } from '@dialect/core';

import { Editor } from './graph/Editor.tsx';
import { GraphName } from './graph/GraphName.tsx';
import { Tabs } from './graph/Tabs.tsx';
import { Settings } from './Settings.tsx';
import { Cards } from './Cards.tsx';
import { Shelf } from './Shelf.tsx';
import { Update } from './Update.tsx';
import { BUILTIN } from './registry.ts';
import { restoreSpend } from './gateway.ts';
import { loadRegistry } from './channel.ts';
import { builtinLibrary, libraryWith, listTemplates } from './templates.ts';
import { STARTER_GRAPH } from './graph/examples.ts';
import { loadOpenTabs, rememberOpenTabs, rememberOpenTabsNow } from './graph/open.ts';
import {
  BLANK_SNAPSHOT,
  isDirty,
  snapshotOf,
  type GraphSnapshot,
} from './graph/useGraphDoc.ts';
import type { SavedGraph } from './graphs.ts';

/** What the editor hands up so the title bar can name and keep the graph. */
interface GraphHandles {
  name: string | undefined;
  dirty: boolean;
  doc: GraphDoc;
  rename: (name: string) => void;
  save: () => void;
  saved: SavedGraph[];
  say: (message: string) => void;
  refresh: () => void;
  snapshot: GraphSnapshot;
  tabId: string;
}

interface Tab {
  id: string;
  snapshot: GraphSnapshot;
}

let nextTabId = 1;
const freshTabId = (): string => `tab-${nextTabId++}`;

export function Shell(): React.ReactElement {
  const [sheet, setSheet] = useState<'memory' | 'cards' | 'settings' | null>(null);
  const [registry, setRegistry] = useState<LoadedRegistry>(BUILTIN);
  const [library, setLibrary] = useState<Library | null>(null);
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [active, setActive] = useState<string>('');
  const [graph, setGraph] = useState<GraphHandles | null>(null);

  useEffect(() => {
    // Cards and templates are read from disk, so the first paint uses what the
    // build shipped and this replaces it a moment later.
    void (async () => {
      // What earlier sessions spent, before anything can be run.
      await restoreSpend();

      // Where the last window was left — every tab of it — or the starter graph
      // the first time.
      const found = await loadOpenTabs();
      const docs = found.length > 0 ? found : [STARTER_GRAPH];
      const opened = docs.map((doc) => ({ id: freshTabId(), snapshot: snapshotOf(doc) }));
      setTabs(opened);
      setActive(opened[0]!.id);

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

  /**
   * The active tab's state, kept up here as it changes.
   *
   * Written through a functional update so this callback can stay stable: the
   * editor reports on every keystroke, and a callback that changed identity
   * would make the editor rebuild itself on every one of them.
   */
  const onGraph = useCallback((state: GraphHandles) => {
    setGraph(state);
    setTabs((all) =>
      all?.map((t) => (t.id === state.tabId ? { ...t, snapshot: state.snapshot } : t)) ?? all,
    );
  }, []);

  // Where we are, written a second after it stops changing. See open.ts.
  useEffect(() => {
    if (tabs) rememberOpenTabs(tabs.map((t) => t.snapshot.doc));
  }, [tabs]);

  /** So a tab can be closed without waiting for the editor to report again. */
  const tabsRef = useRef<Tab[] | null>(null);
  tabsRef.current = tabs;

  const newTab = useCallback((doc?: GraphDoc): void => {
    const tab: Tab = { id: freshTabId(), snapshot: doc ? snapshotOf(doc) : BLANK_SNAPSHOT() };
    setTabs((all) => [...(all ?? []), tab]);
    setActive(tab.id);
  }, []);

  /**
   * Open a document.
   *
   * In the tab that already holds it, if one does — opening the same saved
   * graph twice would otherwise give two tabs with one name and two divergent
   * copies of the same file, and whichever was saved last would win silently.
   * A graph with no name has no identity to match on, so it always gets a tab.
   */
  const openDoc = useCallback((doc: GraphDoc): void => {
    const name = doc.name?.trim();
    const already = name ? tabsRef.current?.find((t) => t.snapshot.doc.name?.trim() === name) : undefined;
    if (already) {
      setActive(already.id);
      return;
    }
    newTab(doc);
  }, [newTab]);

  const closeTab = useCallback((id: string): void => {
    const all = tabsRef.current ?? [];
    const going = all.find((t) => t.id === id);
    if (!going) return;

    if (isDirty(going.snapshot)) {
      const what = going.snapshot.doc.name?.trim() || 'this graph';
      if (!confirm(`${what} has changes that are not saved. Close it anyway?`)) return;
    }

    // Never nothing. A window with no canvas has no way back to having one.
    const left = all.filter((t) => t.id !== id);
    const next = left.length > 0 ? left : [{ id: freshTabId(), snapshot: BLANK_SNAPSHOT() }];
    setTabs(next);

    if (id === active) {
      const was = all.findIndex((t) => t.id === id);
      setActive((next[Math.min(was, next.length - 1)] ?? next[0]!).id);
    }

    // Written straight away rather than on the usual delay: a debounce that has
    // not fired when the window goes away leaves the closed tab's file behind,
    // and it comes back on the next start.
    void rememberOpenTabsNow(next.map((t) => t.snapshot.doc));
  }, [active]);

  const current = tabs?.find((t) => t.id === active);

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
            onOpen={openDoc}
            onNew={() => newTab()}
            onSay={graph.say}
            onDeleted={graph.refresh}
          />
        ) : null}

        <span className="spacer" />

        <button type="button" className="btn ghost" onClick={() => setSheet('memory')}>
          Memory
        </button>
        <button type="button" className="btn ghost" onClick={() => setSheet('cards')}>
          Models
        </button>
        <button type="button" className="btn ghost" onClick={() => setSheet('settings')}>
          Settings
        </button>
      </header>

      {tabs && tabs.length > 0 ? (
        <Tabs
          tabs={tabs.map((t) => ({
            id: t.id,
            name: t.snapshot.doc.name,
            dirty: isDirty(t.snapshot),
          }))}
          active={active}
          onSelect={setActive}
          onClose={closeTab}
          onNew={() => newTab()}
        />
      ) : null}

      {library && current ? (
        /*
         * Keyed by tab, so switching rebuilds the editor from that tab's
         * snapshot rather than trying to reconcile one graph into another.
         * Reconciling is what put a node from one graph at another graph's
         * coordinates, twice.
         */
        <Editor
          key={current.id}
          tabId={current.id}
          registry={registry}
          library={library}
          snapshot={current.snapshot}
          onGraph={onGraph}
        />
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

      {sheet === 'memory' ? (
        <Shelf
          onClose={() => setSheet(null)}
          onChanged={() => void listTemplates().then((t) => setLibrary(libraryWith(t)))}
        />
      ) : null}

      {sheet === 'settings' ? <Settings onClose={() => setSheet(null)} /> : null}

      <Update />
    </div>
  );
}
