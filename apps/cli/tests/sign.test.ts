import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { manifestFor, newKeypair, publicKeyOf, signSet, MANIFEST, SIGNATURE } from '../src/sign.ts';

/** The raw 32 bytes, wrapped back into a key node will verify with. */
const verifierFor = (publicKeyHex: string) =>
  createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(publicKeyHex, 'hex'),
    ]),
    format: 'der',
    type: 'spki',
  });

async function cardFolder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dialect-sign-'));
  await writeFile(join(dir, 'b.yaml'), 'id: b\n');
  await writeFile(join(dir, 'a.yaml'), 'id: a\n');
  await writeFile(join(dir, 'notes.txt'), 'not a card\n');
  return dir;
}

describe('a publisher key', () => {
  it('is thirty-two bytes of hex, which is what a machine trusts', () => {
    const { publicKeyHex } = newKeypair();

    expect(publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same public half every time it is asked', () => {
    const { publicKeyHex, privateKeyPem } = newKeypair();
    expect(publicKeyOf(privateKeyPem)).toBe(publicKeyHex);
  });

  it('is a different key each time, which is the point of generating one', () => {
    expect(newKeypair().publicKeyHex).not.toBe(newKeypair().publicKeyHex);
  });
});

describe('the manifest', () => {
  it('lists every card, in a stable order, and nothing else', async () => {
    const dir = await cardFolder();
    const manifest = await manifestFor(dir, { channel: 'test', version: 3 });

    expect(manifest.files.map((f) => f.name)).toEqual(['a.yaml', 'b.yaml']);
    expect(manifest.version).toBe(3);
    expect(manifest.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await rm(dir, { recursive: true, force: true });
  });

  it('hashes what is in the file, so a later edit stops matching', async () => {
    const dir = await cardFolder();
    const before = await manifestFor(dir, { channel: 'test', version: 1 });

    await writeFile(join(dir, 'a.yaml'), 'id: a\nlabel: changed\n');
    const after = await manifestFor(dir, { channel: 'test', version: 1 });

    expect(after.files[0]?.sha256).not.toBe(before.files[0]?.sha256);
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses a folder with no cards in it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dialect-empty-'));
    await expect(manifestFor(dir, { channel: 'test', version: 1 })).rejects.toThrow(/No cards/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('signing', () => {
  it('signs the bytes it wrote, not the object it was given', async () => {
    const dir = await cardFolder();
    const { publicKeyHex, privateKeyPem } = newKeypair();

    const manifest = await manifestFor(dir, { channel: 'test', version: 1 });
    await signSet(dir, manifest, privateKeyPem);

    const written = await readFile(join(dir, MANIFEST));
    const signature = Buffer.from(await readFile(join(dir, SIGNATURE), 'utf8'), 'hex');

    expect(verify(null, written, verifierFor(publicKeyHex), signature)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('stops verifying if one byte of the manifest changes', async () => {
    const dir = await cardFolder();
    const { publicKeyHex, privateKeyPem } = newKeypair();
    await signSet(dir, await manifestFor(dir, { channel: 'test', version: 1 }), privateKeyPem);

    const written = await readFile(join(dir, MANIFEST));
    const signature = Buffer.from(await readFile(join(dir, SIGNATURE), 'utf8'), 'hex');

    const tampered = Buffer.from(written);
    tampered[tampered.length - 2]! ^= 0x01;

    expect(verify(null, tampered, verifierFor(publicKeyHex), signature)).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it('will not verify under anyone else key', async () => {
    const dir = await cardFolder();
    const mine = newKeypair();
    const stranger = newKeypair();

    await signSet(dir, await manifestFor(dir, { channel: 'test', version: 1 }), mine.privateKeyPem);
    const written = await readFile(join(dir, MANIFEST));
    const signature = Buffer.from(await readFile(join(dir, SIGNATURE), 'utf8'), 'hex');

    expect(verify(null, written, verifierFor(stranger.publicKeyHex), signature)).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a signature the host can read: lower-case hex, 64 bytes', async () => {
    const dir = await cardFolder();
    const { privateKeyPem } = newKeypair();
    await signSet(dir, await manifestFor(dir, { channel: 'test', version: 1 }), privateKeyPem);

    const text = await readFile(join(dir, SIGNATURE), 'utf8');
    expect(text).toMatch(/^[0-9a-f]{128}$/);

    await rm(dir, { recursive: true, force: true });
  });
});
