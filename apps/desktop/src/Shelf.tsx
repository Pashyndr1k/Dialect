/**
 * What has been kept: templates, readings, graphs.
 *
 * A shelf, not a step. Nothing here makes a prompt — these are the things a
 * graph reaches for, so they belong around the canvas rather than on it. Making
 * them is somewhere else in every case: a template is learned by a node and
 * filed from the inspector, a reading is kept from the inspector, a graph is
 * named and saved in the title bar.
 *
 * It is also where a graph is opened from, which used to be a third menu on the
 * toolbar. A list of your saved things is the obvious place to pick one out of,
 * and a menu that only listed them was a second answer to a question already
 * answered here.
 *
 * Every one of them is a file, and the folder button is the honest admission of
 * that: when something here is wrong, a text editor will fix it faster than any
 * panel could.
 */

import { useCallback, useEffect, useState } from 'react';
import type { GraphDoc, SavedSource, Template } from '@dialect/core';

import { deleteSource, listSources, openSourcesFolder } from './sources.ts';
import { deleteTemplate, listTemplates, openTemplatesFolder } from './templates.ts';
import { deleteGraph, listGraphs, openGraphsFolder, type SavedGraph } from './graphs.ts';
import { OPEN_ID } from './graph/open.ts';
import { EXAMPLES } from './graph/examples.ts';

type Tab = 'graphs' | 'templates' | 'readings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'graphs', label: 'Graphs' },
  { id: 'templates', label: 'Templates' },
  { id: 'readings', label: 'Readings' },
];

export interface ShelfProps {
  onClose: () => void;
  onChanged: () => void;
  onOpenGraph: (doc: GraphDoc) => void;
}

interface Row {
  id: string;
  name: string;
  note: string;
  open?: () => void;
  remove?: () => void;
}

export function Shelf({ onClose, onChanged, onOpenGraph }: ShelfProps): React.ReactElement {
  const [tab, setTab] = useState<Tab>('graphs');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [readings, setReadings] = useState<SavedSource[]>([]);
  const [graphs, setGraphs] = useState<SavedGraph[]>([]);
  const [wrong, setWrong] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    void listTemplates().then(setTemplates).catch(() => setTemplates([]));
    void listSources().then(setReadings).catch(() => setReadings([]));
    void listGraphs()
      // The graph that was simply open is not something anyone kept.
      .then((all) => setGraphs(all.filter((g) => g.id !== OPEN_ID)))
      .catch(() => setGraphs([]));
  }, []);

  useEffect(refresh, [refresh]);

  const remove = (go: Promise<void>): void => {
    void go
      .then(() => {
        refresh();
        onChanged();
      })
      .catch((err: Error) => setWrong(err.message));
  };

  const take = (doc: GraphDoc): void => {
    onOpenGraph(doc);
    onClose();
  };

  const rows: Row[] =
    tab === 'graphs'
      ? graphs.map((g) => ({
          id: g.id,
          name: g.doc.name ?? g.id,
          note: `${g.doc.nodes.length} nodes`,
          open: () => take(g.doc),
          remove: () => remove(deleteGraph(g.id)),
        }))
      : tab === 'templates'
        ? templates.map((t) => ({
            id: t.id,
            name: t.name,
            note: [t.modality, t.target].filter(Boolean).join(' · '),
            remove: () => remove(deleteTemplate(t.id)),
          }))
        : readings.map((s) => ({
            id: s.id,
            name: s.name,
            note: `${s.kind} · ${s.role} · ${s.lines.length} lines`,
            remove: () => remove(deleteSource(s.id)),
          }));

  const openFolder = (): void => {
    const go =
      tab === 'templates'
        ? openTemplatesFolder()
        : tab === 'readings'
          ? openSourcesFolder()
          : openGraphsFolder();
    // No longer swallowed: this button did nothing at all for months because
    // the permission it needs was never asked for and the failure was caught
    // and dropped.
    void go.catch((err: Error) => setWrong(err.message));
  };

  return (
    <div className="sheet" role="dialog" aria-label="Kept things">
      <div className="sheet-box">
        <header className="sheet-head">
          <nav className="shelf-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={t.id === tab ? 'btn tab on' : 'btn tab'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <span className="spacer" />
          {/* Which folder is the whole question, so the button says. */}
          <button
            type="button"
            className="btn ghost"
            onClick={openFolder}
            title={`Show the ${tab} folder in the file manager`}
          >
            Show the folder
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </header>

        {wrong ? <p className="shelf-wrong">{wrong}</p> : null}

        {rows.length === 0 ? (
          <p className="shelf-empty">
            {tab === 'graphs'
              ? 'Nothing saved yet. Name a graph in the title bar and press Save.'
              : tab === 'templates'
                ? 'No templates yet. Learn one from a prompt that already works.'
                : 'No readings kept yet. Keep one from the panel after reading a reference.'}
          </p>
        ) : (
          <ul className="shelf">
            {rows.map((r) => (
              <li key={r.id}>
                <div>
                  <b>{r.name}</b>
                  <span>{r.note}</span>
                </div>
                {r.open ? (
                  <button type="button" className="btn ghost" onClick={r.open}>
                    Open
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn danger"
                  onClick={r.remove}
                  title={`Delete ${r.name}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* The examples live with the saved graphs because that is what they
            are: graphs, which happen to have shipped with the app. */}
        {tab === 'graphs' ? (
          <>
            <h4 className="shelf-sub">Examples</h4>
            <ul className="shelf">
              {EXAMPLES.map((ex) => (
                <li key={ex.id}>
                  <div>
                    <b>{ex.doc.name ?? ex.id}</b>
                    <span>
                      {ex.doc.nodes.length} nodes · {ex.about}
                    </span>
                  </div>
                  <button type="button" className="btn ghost" onClick={() => take(ex.doc)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
