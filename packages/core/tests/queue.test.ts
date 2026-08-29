import { describe, expect, it } from 'vitest';

import { createQueue, runQueue, summarise, type QueueItem, type QueueState } from '../src/batch/queue.ts';
import { BudgetExceededError, ProviderError } from '../src/providers/types.ts';

const entries = (n: number): Array<{ id: string; ref: string }> =>
  Array.from({ length: n }, (_, i) => ({ id: `i${i}`, ref: `file-${i}.png` }));

describe('running a batch', () => {
  it('gets through every item', async () => {
    const state = createQueue(entries(20));
    const seen: string[] = [];

    const summary = await runQueue(state, {
      work: async (item) => {
        seen.push(item.id);
        return item.ref.toUpperCase();
      },
    });

    expect(summary.done).toBe(20);
    expect(summary.failed).toBe(0);
    expect(summary.remaining).toBe(0);
    expect(new Set(seen).size).toBe(20);
    expect(state.items[0]?.output).toBe('FILE-0.PNG');
  });

  it('keeps no more than the concurrency in flight', async () => {
    const state = createQueue(entries(30));
    let live = 0;
    let peak = 0;

    await runQueue(state, {
      concurrency: 4,
      work: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 1));
        live -= 1;
      },
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // and it really did run in parallel
  });

  it('carries a thousand items to completion', async () => {
    const state = createQueue(entries(1000));
    const summary = await runQueue(state, { concurrency: 16, work: async () => 'ok' });

    expect(summary.done).toBe(1000);
    expect(summary.remaining).toBe(0);
  });
});

describe('when an item fails', () => {
  it('tries again for something that might improve', async () => {
    const state = createQueue(entries(1));
    let calls = 0;

    const summary = await runQueue(state, {
      maxAttempts: 3,
      work: async () => {
        calls += 1;
        if (calls < 3) throw new ProviderError('rate limited', { retryable: true });
        return 'eventually';
      },
    });

    expect(calls).toBe(3);
    expect(summary.done).toBe(1);
    expect(state.items[0]?.output).toBe('eventually');
  });

  it('gives up once the attempts are spent, and keeps the reason', async () => {
    const state = createQueue(entries(1));
    let calls = 0;

    const summary = await runQueue(state, {
      maxAttempts: 2,
      work: async () => {
        calls += 1;
        throw new ProviderError('still rate limited', { retryable: true });
      },
    });

    expect(calls).toBe(2);
    expect(summary.failed).toBe(1);
    expect(state.items[0]?.error).toContain('still rate limited');
  });

  it('does not retry a failure that will not improve', async () => {
    const state = createQueue(entries(1));
    let calls = 0;

    await runQueue(state, {
      maxAttempts: 5,
      work: async () => {
        calls += 1;
        throw new ProviderError('that is not an image', { retryable: false });
      },
    });

    expect(calls).toBe(1);
    expect(state.items[0]?.state).toBe('failed');
  });

  it('lets the rest of the batch through', async () => {
    const state = createQueue(entries(10));

    const summary = await runQueue(state, {
      maxAttempts: 1,
      work: async (item) => {
        if (item.id === 'i3') throw new ProviderError('broken file', { retryable: false });
        return 'ok';
      },
    });

    expect(summary.done).toBe(9);
    expect(summary.failed).toBe(1);
  });
});

describe('running out of budget', () => {
  it('stops the whole run instead of failing the remainder one at a time', async () => {
    const state = createQueue(entries(50));
    let calls = 0;

    const summary = await runQueue(state, {
      concurrency: 1,
      work: async () => {
        calls += 1;
        if (calls > 5) throw new BudgetExceededError(1.0, 1.0);
        return 'ok';
      },
    });

    expect(summary.done).toBe(5);
    expect(summary.failed).toBe(0); // nothing is marked failed for want of money
    expect(summary.remaining).toBe(45);
    expect(state.stoppedBecause).toContain('cap');
  });

  it('leaves the run resumable once the cap is raised', async () => {
    const state = createQueue(entries(10));
    let allowed = 4;

    await runQueue(state, {
      concurrency: 1,
      work: async () => {
        if (allowed-- <= 0) throw new BudgetExceededError(1.0, 1.0);
        return 'ok';
      },
    });
    expect(summarise(state).done).toBe(4);

    allowed = 100;
    const second = await runQueue(state, { concurrency: 1, work: async () => 'ok' });

    expect(second.done).toBe(10);
    expect(state.stoppedBecause).toBeUndefined();
  });
});

describe('surviving a restart', () => {
  it('picks up only what is left', async () => {
    const first = createQueue(entries(6));
    let allowed = 2;

    await runQueue(first, {
      concurrency: 1,
      work: async () => {
        if (allowed-- <= 0) throw new BudgetExceededError(1, 1);
        return 'ok';
      },
    });

    // Round-tripped through disk, as a resume would be.
    const resumed = JSON.parse(JSON.stringify(first)) as QueueState;
    const retried: string[] = [];

    const summary = await runQueue(resumed, {
      work: async (item) => {
        retried.push(item.id);
        return 'ok';
      },
    });

    expect(summary.done).toBe(6);
    expect(retried).not.toContain('i0'); // already done before the restart
    expect(retried).toHaveLength(4);
  });

  it('re-queues an item the crash left mid-flight', async () => {
    const state = createQueue(entries(3));
    state.items[1]!.state = 'running'; // as a crash would leave it

    const summary = await runQueue(state, { work: async () => 'ok' });
    expect(summary.done).toBe(3);
  });

  it('writes state out after every change, so a crash costs one item at most', async () => {
    const state = createQueue(entries(4));
    const snapshots: number[] = [];

    await runQueue(state, {
      concurrency: 1,
      onChange: (s) => {
        snapshots.push(s.items.filter((i: QueueItem) => i.state === 'done').length);
      },
      work: async () => 'ok',
    });

    // Two writes per item: one when it starts, one when it finishes.
    expect(snapshots).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });
});

describe('cancelling', () => {
  it('stops taking new work and says why', async () => {
    const state = createQueue(entries(100));
    const controller = new AbortController();
    let calls = 0;

    const summary = await runQueue(state, {
      concurrency: 1,
      signal: controller.signal,
      work: async () => {
        if (++calls === 3) controller.abort();
        return 'ok';
      },
    });

    expect(summary.done).toBe(3);
    expect(state.stoppedBecause).toContain('cancelled');
  });
});
