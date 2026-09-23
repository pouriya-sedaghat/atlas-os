import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export type Sha256 = `sha256:${string}`;

export function sha256Bytes(bytes: Uint8Array): Sha256 {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Streams the file so a multi-gigabyte archive is never held in memory. */
export async function sha256File(path: string): Promise<Sha256> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return `sha256:${hash.digest('hex')}`;
}

export function checksumsMatch(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}
