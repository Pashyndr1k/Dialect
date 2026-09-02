import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Gateway } from '../src/providers/gateway.ts';
import { MemoryCache } from '../src/providers/cache.ts';
import { MockProvider } from '../src/providers/mock.ts';

const SCHEMA = z.object({ said: z.string() });

const ask = {
  system: 'you look at pictures',
  instruction: 'what is in this one',
  schema: SCHEMA,
  schemaVersion: '1',
  images: [{ mediaType: 'image/png', base64: 'the-same-picture' }],
};

/**
 * What is cached is the reading of a reference — what the picture shows — and
 * that is a fact about the picture. Switching models must not mean paying to
 * look at everything again.
 *
 * Which model produced an answer is not lost; it moves out of the identity of
 * the question and into the answer, so a reused reading can still say where it
 * came from.
 */
describe('an answer outlives the model that gave it', () => {
  it('is reused after the model changes, without spending', async () => {
    const cache = new MemoryCache();

    const first = new MockProvider([{ said: 'a cowboy' }], { model: 'claude-opus-5' });
    const opus = new Gateway(first, { cache });
    const bought = await opus.extract(ask);

    // A different model, the same question, the same cache. The mock is given
    // no second answer: if it were called at all, the run would fail.
    const second = new MockProvider([], { model: 'claude-sonnet-5' });
    const sonnet = new Gateway(second, { cache });
    const reused = await sonnet.extract(ask);

    expect(reused.value).toEqual(bought.value);
    expect(reused.cached).toBe(true);
    expect(reused.usage.costUsd).toBe(0);
    expect(second.calls).toHaveLength(0);
  });

  it('says which model actually produced it, not the one selected now', async () => {
    const cache = new MemoryCache();
    await new Gateway(new MockProvider([{ said: 'a cowboy' }], { model: 'claude-opus-5' }), {
      cache,
    }).extract(ask);

    const reused = await new Gateway(new MockProvider([], { model: 'claude-sonnet-5' }), {
      cache,
    }).extract(ask);

    // Reporting the selected model here would be a small lie told every time an
    // old answer is reused, and it is exactly the fact someone needs when a
    // reading looks worse than they expected.
    expect(reused.model).toBe('claude-opus-5');
    expect(reused.cachedAt).toBeTruthy();
  });

  it('still refuses to serve a mock answer to a different adapter', async () => {
    const cache = new MemoryCache();
    await new Gateway(new MockProvider([{ said: 'scripted' }]), { cache }).extract(ask);

    // Same question, same model, another adapter: the id stays in the key
    // precisely so a scripted answer cannot reach a real run.
    const other = new MockProvider([{ said: 'genuine' }]);
    Object.defineProperty(other, 'id', { value: 'anthropic' });
    const result = await new Gateway(other, { cache }).extract(ask);

    expect(result.cached).toBe(false);
    expect(result.value).toEqual({ said: 'genuine' });
  });

  it('uses an entry written before answers carried their provenance', async () => {
    const cache = new MemoryCache();
    const gateway = new Gateway(new MockProvider([]), { cache });

    // The bare shape, as older builds wrote it. Still a perfectly good answer;
    // it simply cannot say which model gave it.
    await cache.set(await gateway.keyFor(ask), { said: 'from an older build' });

    const result = await gateway.extract(ask);
    expect(result.value).toEqual({ said: 'from an older build' });
    expect(result.cached).toBe(true);
    expect(result.cachedAt).toBeUndefined();
  });

  it('still re-reads when the question itself changed', async () => {
    const cache = new MemoryCache();
    await new Gateway(new MockProvider([{ said: 'first' }]), { cache }).extract(ask);

    // A different schema version is a different question, whatever the model.
    const again = await new Gateway(new MockProvider([{ said: 'second' }]), { cache }).extract({
      ...ask,
      schemaVersion: '2',
    });

    expect(again.cached).toBe(false);
    expect(again.value).toEqual({ said: 'second' });
  });
});
