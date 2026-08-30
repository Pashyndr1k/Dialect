import type { ItemState } from '@dialect/core';

/**
 * A batch, split along the line the window is split on.
 *
 * `References` is what you gave the app: the files, what reading them will
 * cost, the button that starts, and how each one is getting on. It belongs on
 * the left, under the drop zone that took them.
 *
 * `PromptActions` is what to do with the prompts that came back. It belongs on
 * the right, with the prompt itself.
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

export function References({
  items,
  selected,
  running,
  onRun,
  onStop,
  onClear,
  onSelect,
}: {
  items: BatchItem[];
  selected: string | null;
  running: boolean;
  onRun: () => void;
  onStop: () => void;
  onClear: () => void;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;

  const waiting = countOf(items, 'staged', 'queued');
  const reading = countOf(items, 'running');
  const done = countOf(items, 'done');

  return (
    <div className="batch">
      <div className="batch-h">
        <h3>
          {items.length} reference{items.length === 1 ? '' : 's'}
          <span className="batch-c">
            {running ? `reading ${done + reading} of ${items.length}` : `${done} read`}
          </span>
        </h3>

        <div className="batch-b">
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
      </div>

      <ul className="rows-b">
        {items.map((item) => (
          <li key={item.id} className={`row-b ${item.state}${selected === item.id ? ' sel' : ''}`}>
            <button
              className="row-name"
              title={item.state === 'done' ? 'Show this prompt' : 'Show this reference'}
              onClick={() => onSelect(item.id)}
            >
              {item.name}
            </button>
            <span className="row-state">
              {LABEL[item.state]}
              {item.cached ? ' · cached' : ''}
            </span>
            {item.error ? <span className="row-err">{item.error}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PromptActions({
  done,
  saved,
  onSaveAll,
  onCopyAll,
}: {
  done: number;
  saved: string | null;
  onSaveAll: () => void;
  onCopyAll: () => void;
}) {
  if (done === 0) return null;

  return (
    <div className="prompt-actions">
      <span className="pa-c">
        {done} prompt{done === 1 ? '' : 's'} from this batch
      </span>
      <button className="solid" onClick={onSaveAll}>
        Save {done} to a folder
      </button>
      <button className="ghost" onClick={onCopyAll}>
        Copy all
      </button>
      {saved ? <p className="pa-saved">Written to {saved}</p> : null}
    </div>
  );
}
