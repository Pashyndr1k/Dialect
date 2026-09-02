/**
 * What has been kept: templates, readings, graphs.
 *
 * A shelf, not a step. Nothing here makes a prompt — these are the things a
 * graph reaches for, so they belong around the canvas rather than on it. Making
 * them is somewhere else in every case: a template is learned by a node and
 * filed from the inspector, a reading is kept from the inspector, a graph is
 * saved from the run bar. This is only where they are looked at and thrown
 * away.
 *
 * Every one of them is a file, and the folder button is the honest admission of
 * that: when something here is wrong, a text editor will fix it faster than any
 * panel could.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SavedSource, Template } from '@dialect/core';

import { deleteSource, listSources, openSourcesFolder } from './sources.ts';
import { deleteTemplate, listTemplates, openTemplatesFolder } from './templates.ts';
import { deleteGraph, listGraphs, openGraphsFolder, type SavedGraph } from './graphs.ts';
import { OPEN_ID } from './graph/open.ts';

type Tab = 'templates' | 'readings' | 'graphs';

export function Shelf({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>('templates');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [readings, setReadings] = useState<SavedSource[]>([]);
  const [graphs, setGraphs] = useState<SavedGraph[]>([]);

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
    void go.then(() => {
      refresh();
      onChanged();
    });
  };

  const rows: Array<{ id: string; name: string; note: string; go: () => void }> =
    tab === 'templates'
      ? templates.map((t) => ({
          id: t.id,
          name: t.name,
          note: [t.modality, t.target].filter(Boolean).join(' · '),
          go: () => remove(deleteTemplate(t.id)),
        }))
      : tab === 'readings'
        ? readings.map((s) => ({
            id: s.id,
            name: s.name,
            note: `${s.kind} · ${s.role} · ${s.lines.length} lines`,
            go: () => remove(deleteSource(s.id)),
          }))
        : graphs.map((g) => ({
            id: g.id,
            name: g.doc.name ?? g.id,
            note: `${g.doc.nodes.length} nodes`,
            go: () => remove(deleteGraph(g.id)),
          }));

  const openFolder = (): void => {
    void (tab === 'templates'
      ? openTemplatesFolder()
      : tab === 'readings'
        ? openSourcesFolder()
        : openGraphsFolder());
  };

  return (
    <div className="sheet" role="dialog" aria-label="Kept things">
      <div className="sheet-box">
        <header className="sheet-head">
          <nav className="shelf-tabs">
            {(['templates', 'readings', 'graphs'] as const).map((t) => (
              <button key={t} type="button" className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={openFolder}>
            Open the folder
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>

        {rows.length === 0 ? (
          <p className="shelf-empty">
            {tab === 'templates'
              ? 'No templates yet. Learn one from a prompt that already works.'
              : tab === 'readings'
                ? 'No readings kept yet. Keep one from the inspector after reading a reference.'
                : 'No graphs saved yet.'}
          </p>
        ) : (
          <ul className="shelf">
            {rows.map((r) => (
              <li key={r.id}>
                <div>
                  <b>{r.name}</b>
                  <span>{r.note}</span>
                </div>
                <button type="button" onClick={r.go} title={`Delete ${r.name}`}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
