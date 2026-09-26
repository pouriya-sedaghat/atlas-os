import { createReadStream } from 'node:fs';
import { chmod, lstat, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { PlatformError } from '../../errors.js';
import type { TreeEntry, TreeListing } from './tree.js';
import { SEALED_DIRECTORY_MODE, SEALED_FILE_MODE, listTree } from './tree.js';

/** Where the sealed engine database lives inside a snapshot. */
export const ENGINE_ROOT = 'search/engine';

/**
 * The only top-level entry the engine's import writes under its data directory. Its name is fixed
 * by the engine.
 */
export const ENGINE_DATA_DIRECTORY = 'photon_data';

/** Per-node run-time output the import leaves behind. It records host paths and is never kept. */
const RUNTIME_DIRECTORIES: ReadonlySet<string> = new Set(['logs']);

/** Files the policy treats as text and scans for host paths. Everything else is scanned as bytes. */
const TEXT_EXTENSIONS = ['.json', '.log', '.options', '.properties', '.txt', '.yaml', '.yml'];

/**
 * Absolute host paths a sealed text file must never contain.
 *
 * Anchored at a delimiter so documentation placeholders such as `/path/to/data` in a shipped
 * configuration template do not match, while a real `/home/...`, `/tmp/...` or `C:\...` path does.
 */
const HOST_PATH =
  /(?:^|[\s"'=:,([{])(?:\/(?:home|root|tmp|var|Users|mnt|srv|opt|work|data|private)(?:\/|$)|[A-Za-z]:\\)/mu;

export interface SealedEngine {
  readonly listing: TreeListing;
  /** Checksums keyed by snapshot-relative path, ready to merge into the manifest. */
  readonly checksums: Readonly<Record<string, string>>;
}

function refuse(message: string, details?: Record<string, unknown>): never {
  throw new PlatformError('VALIDATION_FAILED', message, details === undefined ? {} : { details });
}

function isText(path: string): boolean {
  return TEXT_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/** True when `needle` occurs anywhere in the file, including across read boundaries. */
async function fileContains(path: string, needle: Buffer): Promise<boolean> {
  if (needle.length === 0) return false;
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    const window = Buffer.concat([carry, chunk as Buffer]);
    if (window.includes(needle)) return true;
    carry = window.subarray(Math.max(0, window.length - (needle.length - 1)));
  }
  return false;
}

async function textContainsHostPath(path: string): Promise<boolean> {
  let text = '';
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) text += chunk as string;
  return HOST_PATH.test(text);
}

/**
 * Enforces the structural artifact policy on a tree that is already on disk: exactly one
 * top-level data directory, no run-time output, only directories and regular files, and exact
 * modes. Shared by sealing and by validation, which must reach the same verdict.
 */
export function checkEngineStructure(entries: readonly TreeEntry[]): void {
  const topLevel = entries.filter((entry) => !entry.path.includes('/'));
  if (
    topLevel.length !== 1 ||
    topLevel[0]!.path !== ENGINE_DATA_DIRECTORY ||
    topLevel[0]!.type !== 'directory'
  ) {
    refuse('The search engine artifact must contain exactly one data directory.');
  }
  for (const entry of entries) {
    const segments = entry.path.split('/');
    if (segments.length >= 3 && RUNTIME_DIRECTORIES.has(segments[2]!)) {
      refuse('The search engine artifact contains run-time output.', { entry: entry.path });
    }
    const expected = entry.type === 'directory' ? SEALED_DIRECTORY_MODE : SEALED_FILE_MODE;
    // Windows filesystems carry no POSIX permission bits, so there is nothing to compare.
    if (process.platform !== 'win32' && entry.mode !== expected) {
      refuse('The search engine artifact contains an entry with an unexpected mode.', {
        entry: entry.path,
      });
    }
  }
}

/** Scans sealed text files for absolute host paths. Shared by sealing and by validation. */
export async function checkEngineHygiene(
  root: string,
  entries: readonly TreeEntry[],
): Promise<void> {
  for (const entry of entries) {
    if (entry.type !== 'file' || !isText(entry.path)) continue;
    if (await textContainsHostPath(join(root, ...entry.path.split('/')))) {
      refuse('The search engine artifact records a host path.', { entry: entry.path });
    }
  }
}

async function removeRuntimeOutput(root: string): Promise<void> {
  const data = join(root, ENGINE_DATA_DIRECTORY);
  const details = await lstat(data).catch(() => undefined);
  if (details === undefined || !details.isDirectory()) {
    refuse('The search engine import produced no data directory.');
  }
  for (const node of await readdir(data)) {
    const nodePath = join(data, node);
    if (!(await lstat(nodePath)).isDirectory()) continue;
    for (const name of RUNTIME_DIRECTORIES) {
      await rm(join(nodePath, name), { force: true, recursive: true });
    }
  }
}

async function normaliseModes(root: string, entries: readonly TreeEntry[]): Promise<void> {
  for (const entry of entries) {
    const absolute = join(root, ...entry.path.split('/'));
    await chmod(absolute, entry.type === 'directory' ? SEALED_DIRECTORY_MODE : SEALED_FILE_MODE);
  }
}

/**
 * Seals a freshly imported engine database in place so it can be published read-only.
 *
 * Removes the engine's run-time output, normalises modes, refuses links and special files, and
 * proves the tree holds no host path: no text file names one, and no file of any kind contains
 * the exact bytes of the staging directory it was built in. Then records a checksum for every
 * file and the digest of the whole tree.
 */
export async function sealEngineTree(options: {
  /** Absolute path of `search/engine` inside the staging snapshot. */
  readonly engineRoot: string;
  /** Absolute paths that must not appear anywhere in the sealed bytes. */
  readonly forbiddenPaths: readonly string[];
}): Promise<SealedEngine> {
  const root = resolve(options.engineRoot);
  await removeRuntimeOutput(root);

  const unhashed = await listTree(root, { hash: false });
  await normaliseModes(root, unhashed.entries);
  const listing = await listTree(root, { hash: true });
  checkEngineStructure(listing.entries);
  await checkEngineHygiene(root, listing.entries);

  const needles = [...new Set(options.forbiddenPaths.map((path) => resolve(path)))]
    .filter((path) => path.length >= 8)
    .map((path) => Buffer.from(path, 'utf8'));
  for (const entry of listing.entries) {
    if (entry.type !== 'file') continue;
    const absolute = join(root, ...entry.path.split('/'));
    for (const needle of needles) {
      if (await fileContains(absolute, needle)) {
        refuse('The search engine artifact records the directory it was built in.', {
          entry: entry.path,
        });
      }
    }
  }

  const checksums: Record<string, string> = {};
  for (const entry of listing.entries) {
    if (entry.type === 'file') checksums[`${ENGINE_ROOT}/${entry.path}`] = entry.sha256!;
  }
  return { checksums, listing };
}
