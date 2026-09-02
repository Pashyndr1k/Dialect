/**
 * The bar above the canvas.
 *
 * Three jobs: start and stop a run, put a node on the canvas, and say what is
 * about to be spent. The last is why the bar exists at all — a node can show
 * what it cost afterwards, but only something outside the graph can say what
 * pressing the button will cost before it is pressed.
 */

import { useState } from 'react';
import type { GraphDoc } from '@dialect/core';

import { NODES } from './host.ts';
import { EXAMPLES } from './examples.ts';
import { openGraphsFolder, type SavedGraph } from '../graphs.ts';
import { BUDGET_USD } from '../gateway.ts';

const GROUPS = ['in', 'read', 'compose', 'shape', 'out'] as const;

export interface RunBarProps {
  running: boolean;
  canRun: boolean;
  spent: number;
  willSpend: number;
  saved: SavedGraph[];
  onRun: () => void;
  onStop: () => void;
  onAdd: (type: string) => void;
  onOpen: (doc: GraphDoc) => void;
  onSave: () => void;
}

export function RunBar({
  running,
  canRun,
  spent,
  willSpend,
  saved,
  onRun,
  onStop,
  onAdd,
  onOpen,
  onSave,
}: RunBarProps): React.ReactElement {
  const [menu, setMenu] = useState<'add' | 'graphs' | null>(null);
  const toggle = (which: 'add' | 'graphs'): void => setMenu((m) => (m === which ? null : which));

  return (
    <header className="run-bar">
      <button type="button" className="run" disabled={!canRun || running} onClick={onRun}>
        {running ? 'Running…' : 'Run'}
      </button>
      {running ? (
        <button type="button" className="ghost" onClick={onStop}>
          Stop
        </button>
      ) : null}

      <div className="add">
        <button type="button" className="ghost" onClick={() => toggle('add')}>
          Add node
        </button>
        {menu === 'add' ? (
          <ul className="add-menu">
            {GROUPS.map((group) => (
              <li key={group}>
                <b>{group}</b>
                <ul>
                  {[...NODES.values()]
                    .filter((s) => s.group === group)
                    .map((s) => (
                      <li key={s.type}>
                        <button
                          type="button"
                          onClick={() => {
                            onAdd(s.type);
                            setMenu(null);
                          }}
                        >
                          {s.title}
                          {/* Amber wherever money can go, here as on the node. */}
                          {s.spends ? <i className="node-spends" /> : null}
                        </button>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="add">
        <button type="button" className="ghost" onClick={() => toggle('graphs')}>
          Graphs
        </button>
        {menu === 'graphs' ? (
          <ul className="add-menu graph-menu">
            <li>
              <b>this one</b>
              <ul>
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      onSave();
                      setMenu(null);
                    }}
                  >
                    Save
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => void openGraphsFolder()}>
                    Show the folder
                  </button>
                </li>
              </ul>
            </li>
            <li>
              <b>examples</b>
              <ul>
                {EXAMPLES.map((ex) => (
                  <li key={ex.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onOpen(ex.doc);
                        setMenu(null);
                      }}
                    >
                      {ex.doc.name ?? ex.id}
                      <span className="add-cost">{ex.about}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
            <li>
              <b>saved</b>
              <ul>
                {saved.length === 0 ? (
                  <li>
                    <span className="add-empty">none yet</span>
                  </li>
                ) : (
                  saved.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onOpen(g.doc);
                          setMenu(null);
                        }}
                      >
                        {g.doc.name ?? g.id}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </li>
          </ul>
        ) : null}
      </div>

      <span className="spacer" />

      {willSpend > 0 ? (
        <span className="will-spend" title="Nodes that can spend. Cached ones will not.">
          {willSpend} paid step{willSpend === 1 ? '' : 's'}
        </span>
      ) : null}
      <span className="spend" title={`Budget $${BUDGET_USD.toFixed(2)}`}>
        ${spent.toFixed(4)}
      </span>
    </header>
  );
}
