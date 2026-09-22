import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checksumsMatch,
  sha256Bytes,
  sha256File,
} from '../../packages/atlas-os/src/internal/fs/checksum.js';

describe('artifact checksums', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'atlas-checksum-'));
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('hashes bytes and files identically', async () => {
    const payload = new TextEncoder().encode('atlas-os');
    const path = join(directory, 'payload.bin');
    await writeFile(path, payload);
    const expected = sha256Bytes(payload);

    expect(expected).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(sha256File(path)).resolves.toBe(expected);
  });

  it('detects a single changed byte', async () => {
    const path = join(directory, 'mutable.bin');
    await writeFile(path, new Uint8Array([1, 2, 3]));
    const before = await sha256File(path);
    await writeFile(path, new Uint8Array([1, 2, 4]));
    const after = await sha256File(path);

    expect(checksumsMatch(before, after)).toBe(false);
    expect(checksumsMatch(before, before)).toBe(true);
  });

  it('compares digests without an early exit on the first differing character', () => {
    const digest = sha256Bytes(new Uint8Array([0]));
    expect(checksumsMatch(digest, `${digest}extra`)).toBe(false);
    expect(checksumsMatch(digest, digest.replace(/.$/, 'f'))).toBe(digest.endsWith('f'));
  });
});
