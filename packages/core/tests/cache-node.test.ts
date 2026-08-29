import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { FileCache } from '../src/providers/cache-node.ts';
import { Gateway } from '../src/providers/gateway.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { sha256Hex } from '../src/providers/cache.ts';
import { z } from 'zod';

const roots: string[] = [];

async function tempCache(): Promise<{ dir: string; cache: FileCache }> {
  const dir = await mkdtemp(join(tmpdir(), 'dialect-cache-'));
  roots.push(dir);
  return { dir, cache: new FileCache(join(dir, 'entries')) };
}

afterAll(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

const KEY = await sha256Hex('a key');

describe('the cache on disk', () => {
  it('misses before anything is written', async () => {
    const { cache } = await tempCache();
    expect(await cache.get(KEY)).toBeUndefined();
  });

  it('gives back exactly what it was handed', async () => {
    const { cache } = await tempCache();
    const value = { headline: 'a bottle on slate', palette: ['#000'], n: 3, deep: { ok: true } };

    await cache.set(KEY, value);
    expect(await cache.get(KEY)).toEqual(value);
  });

  it('creates its directory on first write rather than at construction', async () => {
    const { dir, cache } = await tempCache();
    await expect(readdir(join(dir, 'entries'))).rejects.toThrow();

    await cache.set(KEY, { a: 1 });
    expect(await readdir(join(dir, 'entries'))).toEqual([`${KEY}.json`]);
  });

  it('leaves no temporary file behind', async () => {
    const { dir, cache } = await tempCache();
    await cache.set(KEY, { a: 1 });

    const files = await readdir(join(dir, 'entries'));
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('treats a corrupt entry as a miss and clears it', async () => {
    const { dir, cache } = await tempCache();
    await cache.set(KEY, { a: 1 });
    await writeFile(join(dir, 'entries', `${KEY}.json`), '{ half a fi', 'utf8');

    // A corrupt entry that kept failing to parse would fail forever.
    expect(await cache.get(KEY)).toBeUndefined();
    expect(await readdir(join(dir, 'entries'))).toEqual([]);
  });

  it('refuses a key that is not one of ours', async () => {
    const { cache } = await tempCache();
    await expect(cache.set('../escape', { a: 1 })).rejects.toThrow(/Not a cache key/);
  });
});

describe('a gateway backed by disk', () => {
  it('spends nothing the second time, even in a new process', async () => {
    const { cache } = await tempCache();
    const answer = { headline: 'a bottle on slate' };
    const schema = z.object({ headline: z.string() });
    const request = {
      system: 'sys',
      instruction: 'go',
      images: [{ mediaType: 'image/png', base64: 'aGk=' }],
      schema,
      schemaVersion: '1',
    };

    const first = new MockProvider([answer]);
    const one = await new Gateway(first, { cache }).extract(request);
    expect(one.cached).toBe(false);
    expect(first.calls).toHaveLength(1);

    // A fresh gateway and a fresh provider, as a restart would bring.
    const second = new MockProvider([]);
    const gateway = new Gateway(second, { cache });
    const two = await gateway.extract(request);

    expect(two.cached).toBe(true);
    expect(two.value).toEqual(answer);
    expect(second.calls).toHaveLength(0); // the mock had no answers left to give
    expect(gateway.spentUsd).toBe(0);
  });
});
