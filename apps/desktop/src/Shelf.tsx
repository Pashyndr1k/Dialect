/**
 * Memory: what the app kept from work already done.
 *
 * Two things, and they share the one property that decides what this panel is
 * for. A reading was paid for once and is free for ever after; a template was
 * learned from a prompt that worked and can be filled in again. Both are the
 * expensive half of some earlier session, kept so it need not happen twice.
 *
 * Graphs used to be a third tab here. They are documents, not memory — you make
 * them, name them, open them — and they belong where a document belongs: in the
 * tabs across the top and the Graph menu beside them. A list in two places is
 * two lists to keep in step.
 *
 * Every one of these is a file, and the folder button is the honest admission
 * of that: when something here is wrong, a text editor will fix it faster than
 * any panel could.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SavedSource, Template } from '@dialect/core';

import { deleteSource, listSources, openSourcesFolder } from './sources.ts';
import { deleteTemplate, listTemplates, openTemplatesFolder } from './templates.ts';

type Tab = 'readings' | 'templates';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'readings', label: 'Readings' },
  { id: 'templates', label: 'Templates' },
];

export interface ShelfProps {
  onClose: () => void;
  onChanged: () => void;
}

interface Row {
  id: string;
  name: string;
  note: string;
  open?: () => void;
  remove?: () => void;
}

export function Shelf({ onClose, onChanged }: ShelfProps): React.ReactElement {
  const [tab, setTab] = useState<Tab>('readings');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [readings, setReadings] = useState<SavedSource[]>([]);
  const [wrong, setWrong] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    void listTemplates().then(setTemplates).catch(() => setTemplates([]));
    void listSources().then(setReadings).catch(() => setReadings([]));
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

  const rows: Row[] =
    tab === 'templates'
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
    const go = tab === 'templates' ? openTemplatesFolder() : openSourcesFolder();
    // No longer swallowed: this button did nothing at all for months because
    // the permission it needs was never asked for and the failure was caught
    // and dropped.
    void go.catch((err: Error) => setWrong(err.message));
  };

  return (
    <div className="sheet" role="dialog" aria-label="Memory">
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
            {tab === 'templates'
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

      </div>
    </div>
  );
}
