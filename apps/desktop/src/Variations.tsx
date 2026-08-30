import {
  AXIS_LABEL,
  decksFor,
  VARY_AXES,
  type Deck,
  type DeckEntry,
  type VaryAxis,
} from '@dialect/core';
import type { CompileResult } from '@dialect/core';

/**
 * Many from one, in the pane where prompt work happens.
 *
 * The same arrangement as the shots, because it is the same shape of problem:
 * one document, several prompts out of it, and a list you read one at a time.
 * Selecting shows a variant's prompt without touching the document — the base
 * is what everything else is a version of, so it is not something to lose by
 * clicking.
 */

export interface Variation {
  label: string;
  compiled: CompileResult;
}

export function Variations({
  axis,
  count,
  deckId,
  decks,
  drawn,
  variations,
  selected,
  working,
  saved,
  cost,
  onAxis,
  onCount,
  onDeck,
  onMake,
  onSelect,
  onUse,
  onCopyAll,
  onSaveAll,
  onClear,
}: {
  axis: VaryAxis;
  count: number;
  deckId: string;
  decks: Deck[];
  /** The card that was drawn, once one has been. */
  drawn: DeckEntry | null;
  variations: Variation[];
  selected: string | null;
  working: boolean;
  saved: string | null;
  cost: number;
  onAxis: (next: VaryAxis) => void;
  onCount: (next: number) => void;
  onDeck: (next: string) => void;
  onMake: () => void;
  onSelect: (label: string | null) => void;
  onUse: (label: string) => void;
  onCopyAll: () => void;
  onSaveAll: () => void;
  onClear: () => void;
}) {
  const open = variations.find((v) => v.label === selected);
  const usable = decksFor(decks, axis);

  return (
    <div className="block seq">
      <div className="seq-h">
        <h3>
          Variations
          {variations.length > 0 ? <span className="count">{variations.length}</span> : null}
          {saved ? <span className="seq-saved"> Saved to {saved}</span> : null}
        </h3>

        <div className="seq-b">
          {variations.length > 0 ? (
            <>
              <button className="ghost" onClick={onCopyAll}>
                Copy all
              </button>
              <button className="ghost" onClick={onSaveAll}>
                Save all
              </button>
              <button className="ghost" onClick={onClear}>
                Close
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="vary-row">
        <select value={axis} title="What is allowed to change" onChange={(e) => onAxis(e.target.value as VaryAxis)}>
          {VARY_AXES.map((a) => (
            <option key={a} value={a}>
              {AXIS_LABEL[a]}
            </option>
          ))}
        </select>

        <input
          className="row-s-dur"
          type="number"
          min={2}
          max={24}
          title="How many"
          value={count}
          onChange={(e) => onCount(Number.parseInt(e.target.value, 10) || 2)}
        />

        <select
          value={deckId}
          title="Draw one card, and every version has to satisfy it"
          onChange={(e) => onDeck(e.target.value)}
        >
          <option value="">No deck</option>
          {usable.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <button className="solid go" disabled={working} onClick={onMake}>
          {working ? 'Working…' : `Make · $${cost.toFixed(2)}`}
        </button>
      </div>

      {drawn ? (
        <p className="quiet vary-drew">
          <strong>{drawn.name}</strong> — {drawn.text}
        </p>
      ) : null}

      {variations.length > 0 ? (
        <ul className="rows-s">
          {variations.map((v) => (
            <li
              key={v.label}
              className={`row-s${selected === v.label ? ' sel' : ''}${v.compiled.blocked ? ' bad' : ''}`}
            >
              <div className="row-s-top">
                <button
                  className="row-name"
                  title="Show this prompt"
                  onClick={() => onSelect(selected === v.label ? null : v.label)}
                >
                  {v.label}
                </button>
                <button className="ref-k" onClick={() => onUse(v.label)}>
                  use
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="seq-open">
          <h3>{open.label}</h3>
          <pre className="out">{open.compiled.render.text}</pre>
        </div>
      ) : null}
    </div>
  );
}
