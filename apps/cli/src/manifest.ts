/**
 * Describing a card set, so the app can say which one is installed.
 *
 * This used to sign one. The app required an Ed25519 signature from a key you
 * had trusted first, and this was the other half of that: keygen, a private key
 * to look after, a 64-character public key to paste in before anything would
 * install. All of it for a folder of YAML formulas that the app will happily
 * let you edit by hand in the panel next door.
 *
 * What is left is the part that was doing real work: a manifest naming the set,
 * its version and its cards. The version is what stops a set being replaced by
 * an older one, which is a mistake people actually make.
 *
 * A set does not need one at all — the app installs a bare folder of `.yaml`
 * files. Write a manifest when you want the set named and numbered.
 */

import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MANIFEST = 'manifest.json';

export interface Manifest {
  channel: string;
  version: number;
  published: string;
  /** The cards, by file name. */
  files: string[];
}

/** Every card in a folder, in a stable order. */
export async function manifestFor(
  dir: string,
  meta: { channel: string; version: number; published?: string },
): Promise<Manifest> {
  const files = (await readdir(dir))
    .filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'))
    .sort();

  return {
    channel: meta.channel,
    version: meta.version,
    // The day, not the moment: a set published twice in an afternoon is one
    // set, and a timestamp would only make two identical things look different.
    published: meta.published ?? new Date().toISOString().slice(0, 10),
    files,
  };
}

/** Write the manifest into the folder it describes. */
export async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
  await writeFile(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}
