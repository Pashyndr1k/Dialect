/**
 * The menu you get on a right-click.
 *
 * Until now that was the web view's own: Back, Reload, View Page Source, Save
 * Image As. None of it meant anything here, and half of it would have been
 * alarming — this is an application, and being reminded it is a browser
 * underneath is the interface leaking.
 *
 * What replaces it depends on what you clicked. On a node: the things you do to
 * that node. On empty canvas: adding one, which is the reason a right-click
 * exists in every node editor there has ever been, and is therefore first.
 */

import { useEffect, useRef, useState } from 'react';

import { GROUPS } from '@dialect/core';

import { NODES } from './host.ts';

export interface Spot {
  /** Where on screen, so the menu opens under the pointer. */
  x: number;
  y: number;
  /** Which node was under the pointer, if any. */
  node?: string | undefined;
  /** Where in the graph, so a node added here lands where you pointed. */
  at: { x: number; y: number };
}

/** The catalogue's width, in pixels, matching `.ctx-menu` in the stylesheet. */
const SUB_WIDTH = 240;

export interface ContextMenuProps {
  spot: Spot;
  canUndo: boolean;
  canRedo: boolean;
  onAdd: (type: string, at: { x: number; y: number }) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onRun: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onClose: () => void;
}

export function ContextMenu({
  spot,
  canUndo,
  canRedo,
  onAdd,
  onDuplicate,
  onRemove,
  onRun,
  onUndo,
  onRedo,
  onFit,
  onClose,
}: ContextMenuProps): React.ReactElement {
  const box = useRef<HTMLDivElement>(null);
  /** Whether the catalogue has to open leftwards to stay on screen. */
  const [flip, setFlip] = useState(false);
  /**
   * Held open by a click, as well as by the pointer being over it.
   *
   * Hover alone made this the one control in the window that did nothing when
   * you clicked it, which is indistinguishable from broken — and on a keyboard
   * it could only be reached by tabbing into it and hoping.
   */
  const [pinned, setPinned] = useState(false);

  // Escape closes it, like every other menu on the machine.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Nudged back on screen when it would otherwise open past the edge — and the
   * catalogue told which way to open.
   *
   * Measured rather than guessed from the window width. A breakpoint answers
   * "is the window narrow", and the question is "is there room to the right of
   * this menu, where it actually opened", which is not the same question and
   * had the submenu sliding off the left of a perfectly ordinary window.
   */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = `${Math.max(4, window.innerWidth - r.width - 8)}px`;
    if (r.bottom > window.innerHeight) el.style.top = `${Math.max(4, window.innerHeight - r.height - 8)}px`;

    const after = el.getBoundingClientRect();
    const wanted = SUB_WIDTH;
    // Rightwards unless it will not fit and leftwards will: off the right is
    // recoverable by scrolling nothing, off the left is simply gone.
    setFlip(after.right + wanted > window.innerWidth && after.left - wanted > 0);
  }, [spot]);

  const done = (go: () => void): void => {
    go();
    onClose();
  };

  return (
    <>
      <div className="menu-shade" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div ref={box} className={`ctx${flip ? ' ctx-flip' : ''}`} style={{ left: spot.x, top: spot.y }}>
        {spot.node ? (
          <>
            <button type="button" onClick={() => done(() => onDuplicate(spot.node!))}>
              Duplicate node
            </button>
            <button type="button" className="ctx-bad" onClick={() => done(() => onRemove(spot.node!))}>
              Delete node
            </button>
            <hr />
          </>
        ) : null}

        {/* First, always: it is what a right-click on a canvas is for. */}
        <div className={pinned ? 'ctx-sub on' : 'ctx-sub'}>
          <button
            type="button"
            className="ctx-parent"
            aria-expanded={pinned}
            onClick={() => setPinned((p) => !p)}
          >
            Add node <span>▸</span>
          </button>
          <div className="ctx-menu">
            {GROUPS.map((g) => (
              <section key={g.id}>
                <h4>{g.label}</h4>
                {[...NODES.values()]
                  .filter((s) => s.group === g.id)
                  .map((s) => (
                    <button key={s.type} type="button" onClick={() => done(() => onAdd(s.type, spot.at))}>
                      {s.title}
                      {s.spends ? <i className="node-spends" title="This one can spend" /> : null}
                      <span>{s.hint}</span>
                    </button>
                  ))}
              </section>
            ))}
          </div>
        </div>

        <hr />

        <button type="button" onClick={() => done(onRun)}>
          Run the graph
        </button>

        <hr />

        <button type="button" disabled={!canUndo} onClick={() => done(onUndo)}>
          Undo <span className="ctx-key">Ctrl+Z</span>
        </button>
        <button type="button" disabled={!canRedo} onClick={() => done(onRedo)}>
          Redo <span className="ctx-key">Ctrl+Shift+Z</span>
        </button>

        <hr />

        <button type="button" onClick={() => done(onFit)}>
          Fit to the window
        </button>
      </div>
    </>
  );
}
