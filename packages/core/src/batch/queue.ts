/**
 * The batch queue.
 *
 * Three things make a batch of a thousand references survivable, and all three
 * are here rather than in whichever surface is driving it: the run is
 * resumable, because its state is plain data written out after every change; a
 * failure that will not improve on a retry is not retried; and running out of
 * budget stops the whole run instead of burning through the remainder failing
 * one item at a time.
 */

import { BudgetExceededError, ProviderError } from '../providers/types.ts';

export type ItemState = 'queued' | 'running' | 'done' | 'failed';

export interface QueueItem {
  /** Stable across restarts — a path, or a content hash. */
  id: string;
  /** What to show a person. Usually the file name. */
  ref: string;
  state: ItemState;
  attempts: number;
  error?: string;
  /** Set once the item succeeds. Serialisable, so it survives a restart. */
  output?: unknown;
}

export const QUEUE_VERSION = 1 as const;

export interface QueueState {
  version: typeof QUEUE_VERSION;
  items: QueueItem[];
  spentUsd: number;
  /** Why the run ended early, if it did. */
  stoppedBecause?: string;
}

export function createQueue(entries: Array<{ id: string; ref: string }>): QueueState {
  return {
    version: QUEUE_VERSION,
    items: entries.map(({ id, ref }) => ({ id, ref, state: 'queued', attempts: 0 })),
    spentUsd: 0,
  };
}

export interface RunOptions {
  /** How many items are in flight at once. */
  concurrency?: number;
  /** Total tries per item, including the first. */
  maxAttempts?: number;
  /** Does the work. Throw to fail the item. */
  work: (item: QueueItem) => Promise<unknown>;
  /**
   * Called after every state change, so a crash loses at most one item's
   * progress. Awaited: a persist that lags behind is not a persist.
   */
  onChange?: (state: QueueState) => void | Promise<void>;
  /** Stop before starting anything further. */
  signal?: AbortSignal;
}

export interface RunSummary {
  state: QueueState;
  done: number;
  failed: number;
  remaining: number;
}

/** A failure worth another attempt. Anything unrecognised is not retried. */
function retryable(error: unknown): boolean {
  return error instanceof ProviderError && error.retryable;
}

/** A failure that ends the whole run rather than this one item. */
function fatal(error: unknown): boolean {
  return error instanceof BudgetExceededError;
}

export function summarise(state: QueueState): RunSummary {
  return {
    state,
    done: state.items.filter((i) => i.state === 'done').length,
    failed: state.items.filter((i) => i.state === 'failed').length,
    remaining: state.items.filter((i) => i.state === 'queued' || i.state === 'running').length,
  };
}

export async function runQueue(state: QueueState, options: RunOptions): Promise<RunSummary> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);

  // An item left `running` by a crash is queued again: it either never
  // finished or finished without being recorded, and re-running is the only
  // one of those we can act on. The cache makes the second case cheap.
  for (const item of state.items) {
    if (item.state === 'running') item.state = 'queued';
  }
  delete state.stoppedBecause;

  const persist = async (): Promise<void> => {
    await options.onChange?.(state);
  };

  let stopped: string | undefined;

  /**
   * Fresh work first, retries after everything already waiting — a retry that
   * jumps the queue just hits the same rate limit again. Marking the item
   * `running` here is what stops two workers claiming it: nothing awaits
   * between the find and the write.
   */
  const claim = (): QueueItem | undefined => {
    const item =
      state.items.find((i) => i.state === 'queued' && i.attempts === 0) ??
      state.items.find((i) => i.state === 'queued');
    if (item) item.state = 'running';
    return item;
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopped !== undefined) return;
      if (options.signal?.aborted) {
        stopped ??= 'the run was cancelled';
        return;
      }

      const item = claim();
      if (!item) return;

      await persist();

      try {
        item.output = await options.work(item);
        item.state = 'done';
        delete item.error;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (fatal(error)) {
          // Put it back: it was never attempted in any meaningful sense.
          item.state = 'queued';
          item.attempts = Math.max(0, item.attempts);
          stopped = message;
          await persist();
          return;
        }

        item.attempts += 1;
        item.error = message;

        if (retryable(error) && item.attempts < maxAttempts) {
          item.state = 'queued';
        } else {
          item.state = 'failed';
        }
      }

      await persist();
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (stopped !== undefined) {
    state.stoppedBecause = stopped;
    await persist();
  }

  return summarise(state);
}
