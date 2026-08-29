/**
 * A cache that survives a restart.
 *
 * The in-memory one is enough for a session; a batch that resumes tomorrow
 * needs the answers still to be there, or resuming costs as much as starting
 * over. One file per entry, named by the content hash the gateway already
 * computes.
 *
 * Node-only, like the other `*-node` modules, so core stays portable.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResultCache } from './cache.ts';

/** The gateway's keys are sha256 hex; anything else is not ours to write. */
const KEY = /^[0-9a-f]{64}$/;

export class FileCache implements ResultCache {
  readonly #dir: string;
  #ready: Promise<void> | undefined;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async #ensure(): Promise<void> {
    this.#ready ??= mkdir(this.#dir, { recursive: true }).then(() => undefined);
    return this.#ready;
  }

  #path(key: string): string {
    if (!KEY.test(key)) throw new Error(`Not a cache key: ${key}`);
    return join(this.#dir, `${key}.json`);
  }

  async get(key: string): Promise<unknown | undefined> {
    try {
      return JSON.parse(await readFile(this.#path(key), 'utf8')) as unknown;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return undefined;

      // A half-written or corrupt entry is worse than a miss: it would fail
      // forever. Drop it and let the caller fetch again.
      if (err instanceof SyntaxError) {
        await unlink(this.#path(key)).catch(() => undefined);
        return undefined;
      }
      throw err;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.#ensure();
    const path = this.#path(key);

    // Written aside and renamed, so a crash mid-write leaves the old entry or
    // no entry — never half of one.
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(value), 'utf8');
    await rename(temp, path);
  }
}
