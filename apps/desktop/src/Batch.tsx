import type { ItemState } from '@dialect/core';

/**
 * The batch list.
 *
 * Dropping one reference reads it straight away — it is a cheap, deliberate
 * act. Dropping twelve stages them and waits, because twelve is a spend worth
 * seeing before it happens.
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

export function Batch({
  items,
  selected,
  running,
  spent,
  onRun,
  onStop,
  onSelect,
  onClear,
  onCopyOne,
  onCopyAll,
  onSaveAll,
  saved,
}: {
  items: BatchItem[];
  selected: string | null;
  running: boolean;
  spent: number;
  onRun: () => void;
  onStop: () => void;
  onSelect: (id: string) => void;
  onClear: () => void;
  onCopyOne: (id: string) => void;
  onCopyAll: () => void;
  onSaveAll: () => void;
  saved: string | null;
}) {
  const staged = items.filter((i) => i.state === 'staged' || i.state === 'queued').length;
  const done = items.filter((i) => i.state === 'done').length;
  const failed = items.filter((i) => i.state === 'failed').length;

  return (
    <div className="batch">
      <div className="batch-h">
        <h3>
          {items.length} references
          <span className="batch-c">
            {done > 0 ? `${done} read` : null}
            {done > 0 && failed > 0 ? ' · ' : null}
            {failed > 0 ? `${failed} failed` : null}
            {spent > 0 ? `${done > 0 || failed > 0 ? ' · ' : ''}$${spent.toFixed(4)}` : null}
          </span>
        </h3>

        <div className="batch-b">
          {running ? (
            <button className="ghost" onClick={onStop}>
              Stop
            </button>
          ) : (
            <>
              {staged > 0 ? (
                <button className={done > 0 ? 'ghost' : 'solid'} onClick={onRun}>
                  Read {staged} · about ${(staged * PER_REFERENCE_USD).toFixed(2)}
                </button>
              ) : null}
              {done > 0 ? (
                <>
                  <button className="solid" onClick={onSaveAll}>
                    Save {done} to a folder
                  </button>
                  <button className="ghost" onClick={onCopyAll}>
                    Copy all
                  </button>
                </>
              ) : null}
              <button className="ghost" onClick={onClear}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {saved ? <p className="batch-saved">Written to {saved}</p> : null}

      <ul className="rows-b">
        {items.map((item) => (
          <li key={item.id} className={`row-b ${item.state}${selected === item.id ? ' sel' : ''}`}>
            <button
              className="row-name"
              disabled={item.state !== 'done'}
              title={item.state === 'done' ? 'Open this one' : LABEL[item.state]}
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
