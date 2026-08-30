import type { ItemState } from '@dialect/core';

/**
 * The batch, split the way the window is split.
 *
 * `BatchControls` is input: what was dropped, what reading it will cost, and
 * the button that starts. It belongs on the left with the drop zone.
 *
 * `BatchResults` is prompts: which result is showing, and what to do with the
 * set of them. It belongs on the right, above the prompt it selects between.
 *
 * One list, two halves — the same five files never appear twice.
 */

export interface BatchItem {
  id: string;
  name: string;
  state: ItemState | 'staged';
  error?: string;
  cached?: boolean;
}

const LABEL: Record<BatchItem['state'], string> = {
  staged: 'waiting',
  queued: 'queued',
  running: 'reading',
  done: 'read',
  failed: 'failed',
};

/** Roughly what one reference costs on the default model. Deliberately rough. */
const PER_REFERENCE_USD = 0.07;

const countOf = (items: BatchItem[], ...states: Array<BatchItem['state']>): number =>
  items.filter((i) => states.includes(i.state)).length;

export function BatchControls({
  items,
  running,
  onRun,
  onStop,
  onClear,
}: {
  items: BatchItem[];
  running: boolean;
  onRun: () => void;
  onStop: () => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;

  const waiting = countOf(items, 'staged', 'queued');
  const reading = countOf(items, 'running');
  const done = countOf(items, 'done');

  return (
    <div className="staging">
      <span className="staging-c">
        {running
          ? `reading ${done + reading} of ${items.length}`
          : `${items.length} reference${items.length === 1 ? '' : 's'}`}
      </span>

      {running ? (
        <button className="ghost" onClick={onStop}>
          Stop
        </button>
      ) : (
        <>
          {waiting > 0 ? (
            <button className="solid" onClick={onRun}>
              Read {waiting} · about ${(waiting * PER_REFERENCE_USD).toFixed(2)}
            </button>
          ) : null}
          <button className="ghost" onClick={onClear}>
            Clear
          </button>
        </>
      )}
    </div>
  );
}

export function BatchResults({
  items,
  selected,
  onSelect,
  onCopyOne,
  onCopyAll,
  onSaveAll,
  saved,
}: {
  items: BatchItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  onCopyOne: (id: string) => void;
  onCopyAll: () => void;
  onSaveAll: () => void;
  saved: string | null;
}) {
  if (items.length === 0) return null;

  const done = countOf(items, 'done');
  const failed = countOf(items, 'failed');

  return (
    <div className="batch">
      <div className="batch-h">
        <h3>
          Results
          <span className="batch-c">
            {done > 0 ? `${done} read` : 'none yet'}
            {failed > 0 ? ` · ${failed} failed` : ''}
          </span>
        </h3>

        {done > 0 ? (
          <div className="batch-b">
            <button className="solid" onClick={onSaveAll}>
              Save {done} to a folder
            </button>
            <button className="ghost" onClick={onCopyAll}>
              Copy all
            </button>
          </div>
        ) : null}
      </div>

      {saved ? <p className="batch-saved">Written to {saved}</p> : null}

      <ul className="rows-b">
        {items.map((item) => (
          <li key={item.id} className={`row-b ${item.state}${selected === item.id ? ' sel' : ''}`}>
            <button
              className="row-name"
              disabled={item.state !== 'done'}
              title={item.state === 'done' ? 'Show this prompt' : LABEL[item.state]}
              onClick={() => onSelect(item.id)}
            >
              {item.name}
            </button>
            <span className="row-state">
              {LABEL[item.state]}
              {item.cached ? ' · cached' : ''}
            </span>
            {item.state === 'done' ? (
              <button className="row-copy" title="Copy this prompt" onClick={() => onCopyOne(item.id)}>
                copy
              </button>
            ) : null}
            {item.error ? <span className="row-err">{item.error}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
