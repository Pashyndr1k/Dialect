/**
 * The bar above the canvas.
 *
 * Centred, because it is the only thing on screen you reach for repeatedly and
 * a control you use constantly should not be in a corner. Three groups, in the
 * order the work happens: build, run, and what it is costing.
 *
 * Saving and opening are not here any more. A graph has a name now, and the
 * name lives in the title bar where a document's name belongs — so keeping it
 * belongs there too, next to the thing being named.
 */

import { useState } from 'react';

import { GROUPS } from '@dialect/core';

import { NODES } from './host.ts';

export interface RunBarProps {
  running: boolean;
  canRun: boolean;
  spent: number;
  willSpend: number;
  onRun: () => void;
  onStop: () => void;
  onAdd: (type: string) => void;
}

export function RunBar({
  running,
  canRun,
  spent,
  willSpend,
  onRun,
  onStop,
  onAdd,
}: RunBarProps): React.ReactElement {
  const [adding, setAdding] = useState(false);

  return (
    <header className="run-bar">
      <div className="bar-group">
        <button type="button" className="btn ghost" onClick={() => setAdding((a) => !a)}>
          Add node
        </button>

        {adding ? (
          <>
            {/* Anywhere else closes it, so the menu never has to be dismissed
                deliberately. */}
            <div className="menu-shade" onClick={() => setAdding(false)} />
            <div className="add-menu">
              {GROUPS.map((group) => (
                <section key={group.id}>
                  <h4>{group.label}</h4>
                  {[...NODES.values()]
                    .filter((s) => s.group === group.id && !s.hidden)
                    .map((s) => (
                      <button
                        key={s.type}
                        type="button"
                        onClick={() => {
                          onAdd(s.type);
                          setAdding(false);
                        }}
                      >
                        <b>
                          {s.title}
                          {s.spends ? <i className="node-spends" title="This one can spend" /> : null}
                        </b>
                        {/* One line about what it is for. Sixteen bare names is
                            a list of guesses, not a catalogue. */}
                        <span>{s.hint}</span>
                      </button>
                    ))}
                </section>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="bar-group">
        <button type="button" className="btn run" disabled={!canRun || running} onClick={onRun}>
          {running ? 'Running…' : 'Run'}
        </button>
        {running ? (
          <button type="button" className="btn ghost" onClick={onStop}>
            Stop
          </button>
        ) : null}
      </div>

      <div className="bar-group bar-cost">
        {willSpend > 0 ? (
          <span className="will-spend" title="Steps that can spend. Cached ones will not.">
            {willSpend} paid
          </span>
        ) : null}
        <span className="spend" title="Spent so far">
          ${spent.toFixed(4)}
        </span>
      </div>
    </header>
  );
}
