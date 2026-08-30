/**
 * Signing a card set, so a machine that trusts you will install it.
 *
 * The other half of the channel. Verification lives in the desktop host,
 * because a page cannot vouch for its own replacement; signing lives here,
 * because it needs a private key and a private key does not belong in an app
 * anyone might be looking at the screen of.
 *
 * Ed25519, from `node:crypto`. No dependency, and the same primitive the host
 * verifies with — a mismatch between the two would be a very quiet failure.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
} from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MANIFEST = 'manifest.json';
export const SIGNATURE = 'manifest.sig';

export interface Keypair {
  /** 32 bytes, hex. What a machine trusts. */
  publicKeyHex: string;
  /** PKCS#8 PEM. What signs. Never leaves the publisher. */
  privateKeyPem: string;
}

/**
 * Ed25519 keys are fixed-length, and the raw 32 bytes sit at the end of the
 * DER wrapper `node:crypto` exports — so they can be sliced off rather than
 * parsed, which is what every other implementation of this does too.
 */
export function newKeypair(): Keypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });

  return {
    publicKeyHex: Buffer.from(der.subarray(der.length - 32)).toString('hex'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** The public half of a key that was saved earlier, for printing again. */
export const publicKeyOf = (privateKeyPem: string): string => {
  // A private key cannot export as spki; the public one derived from it can.
  const der = createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: 'spki',
    format: 'der',
  });
  return Buffer.from(der.subarray(der.length - 32)).toString('hex');
};

export interface ManifestFile {
  name: string;
  sha256: string;
}

export interface Manifest {
  channel: string;
  version: number;
  published: string;
  files: ManifestFile[];
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Every card in a folder, hashed, in a stable order. */
export async function manifestFor(
  dir: string,
  meta: { channel: string; version: number; published?: string },
): Promise<Manifest> {
  const names = (await readdir(dir))
    .filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'))
    .sort();

  if (names.length === 0) throw new Error(`No cards in ${dir}.`);

  const files: ManifestFile[] = [];
  for (const name of names) {
    files.push({ name, sha256: sha256(await readFile(join(dir, name))) });
  }

  return {
    channel: meta.channel,
    version: meta.version,
    published: meta.published ?? new Date().toISOString().slice(0, 10),
    files,
  };
}

/**
 * Write the manifest and its signature beside the cards.
 *
 * The signature covers the exact bytes written, not the object: the verifier
 * checks what it downloaded, and a manifest that re-serialises differently
 * would verify something nobody signed.
 */
export async function signSet(
  dir: string,
  manifest: Manifest,
  privateKeyPem: string,
): Promise<{ bytes: number; signature: string }> {
  const bytes = Buffer.from(JSON.stringify(manifest));
  const signature = signBytes(null, bytes, privateKeyPem).toString('hex');

  await writeFile(join(dir, MANIFEST), bytes);
  await writeFile(join(dir, SIGNATURE), signature, 'utf8');

  return { bytes: bytes.length, signature };
}
