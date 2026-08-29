import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One version, in three places that cannot import each other.
 *
 * The workspace root holds it; Cargo and Tauri need their own copies in semver
 * form. Nothing stops those drifting apart except this, and a version the
 * window disagrees with is worse than no version at all.
 */

const at = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

const json = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(at(path), 'utf8')) as Record<string, unknown>;

describe('the version', () => {
  it('is two numbers at the root, which is what the window shows', async () => {
    const root = await json('package.json');
    expect(root['version']).toMatch(/^\d+\.\d+$/);
  });

  it('is the same version Tauri and Cargo were told', async () => {
    const display = (await json('package.json'))['version'] as string;
    const semver = `${display}.0`;

    expect((await json('apps/desktop/src-tauri/tauri.conf.json'))['version']).toBe(semver);

    const cargo = await readFile(at('apps/desktop/src-tauri/Cargo.toml'), 'utf8');
    expect(cargo).toMatch(new RegExp(`^version = "${semver.replace(/\./g, '\\.')}"$`, 'm'));
  });
});
