import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { PlatformError } from '../../errors.js';

/** Exact modes a sealed engine tree carries. */
export const SEALED_DIRECTORY_MODE = 0o755;
export const SEALED_FILE_MODE = 0o644;

export interface TreeEntry {
  /** Relative POSIX path from the tree root. */
  readonly path: string;
  readonly type: 'directory' | 'file';
  /** Permission bits only (`mode & 0o7777`). */
  readonly mode: number;
  /** Byte count for files, 0 for directories. */
  readonly size: number;
  /** `sha256:<hex>` for files, `null` for directories. */
  readonly sha256: string | null;
}

export interface TreeListing {
  readonly entries: readonly TreeEntry[];
  readonly bytes: number;
  readonly files: number;
  readonly directories: number;
  readonly digest: string;
}

export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest('hex')}`;
}

function compare(left: string, right: string): number {
  // Byte order of the UTF-8 encoding, so the digest never depends on locale collation.
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/**
 * The deterministic digest of a tree: sorted relative paths with their types, sizes and hashes.
 * Two trees share a digest only if every one of those agrees.
 *
 * Permission bits are deliberately not part of the digest. A Windows host cannot represent them,
 * so the same sealed tree must digest identically there; the artifact policy enforces the exact
 * modes separately wherever the host filesystem carries them.
 */
export function treeDigest(entries: readonly TreeEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((a, b) => compare(a.path, b.path))) {
    hash.update(
      `${entry.type === 'directory' ? 'd' : 'f'}\t${entry.size}\t${entry.sha256 ?? '-'}\t${entry.path}\n`,
      'utf8',
    );
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Lists a tree without following links.
 *
 * Symbolic links, sockets, devices and FIFOs are refused outright: a sealed artifact contains
 * only directories and regular files, so anything else is either tampering or a build defect.
 */
export async function listTree(
  root: string,
  options: { readonly hash?: boolean } = {},
): Promise<TreeListing> {
  const entries: TreeEntry[] = [];
  const hash = options.hash ?? true;

  async function visit(absolute: string, relative: string): Promise<void> {
    const names = (await readdir(absolute)).sort(compare);
    for (const name of names) {
      const childAbsolute = join(absolute, name);
      const childRelative = relative === '' ? name : `${relative}/${name}`;
      if (name.includes('\\') || name === '.' || name === '..') {
        throw new PlatformError('VALIDATION_FAILED', 'Search artifact contains an unsafe name.');
      }
      const stats = await lstat(childAbsolute);
      if (stats.isDirectory()) {
        entries.push({
          mode: stats.mode & 0o7777,
          path: childRelative,
          sha256: null,
          size: 0,
          type: 'directory',
        });
        await visit(childAbsolute, childRelative);
      } else if (stats.isFile()) {
        entries.push({
          mode: stats.mode & 0o7777,
          path: childRelative,
          sha256: hash ? await sha256OfFile(childAbsolute) : null,
          size: stats.size,
          type: 'file',
        });
      } else {
        throw new PlatformError(
          'VALIDATION_FAILED',
          'Search artifact contains an entry that is neither a directory nor a regular file.',
          { details: { entry: childRelative } },
        );
      }
    }
  }

  await visit(root, '');
  const files = entries.filter((entry) => entry.type === 'file');
  return {
    bytes: files.reduce((sum, entry) => sum + entry.size, 0),
    digest: treeDigest(entries),
    directories: entries.length - files.length,
    entries,
    files: files.length,
  };
}
