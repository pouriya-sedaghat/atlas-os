import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rename, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';

import { PlatformError } from '../../../errors.js';
import type { TreeListing } from '../tree.js';
import { SEALED_DIRECTORY_MODE, listTree } from '../tree.js';

export type CopyMethod = 'clone' | 'copy';

/** What the sealed tree needs, as recorded in the manifest. */
export interface ExpectedTree {
  readonly bytes: number;
  readonly files: number;
  readonly directories: number;
  readonly treeDigest: string;
}

export interface SpacePlan {
  /** Bytes a full, independent copy needs, including per-entry allocation and the reserve. */
  readonly requiredBytes: number;
  readonly availableBytes: number;
  readonly sufficient: boolean;
}

/**
 * Plans the space a full copy needs from the tree's own size and the filesystem's block size.
 * Nothing is assumed about the region: a larger extract simply records a larger tree.
 */
export function planSpace(options: {
  readonly tree: Pick<ExpectedTree, 'bytes' | 'files' | 'directories'>;
  readonly blockSize: number;
  readonly availableBytes: number;
  readonly reserveBytes: number;
}): SpacePlan {
  const block = Math.max(1, options.blockSize);
  const entries = options.tree.files + options.tree.directories;
  // Every entry can waste up to one block to allocation granularity.
  const requiredBytes = options.tree.bytes + entries * block + options.reserveBytes;
  return {
    availableBytes: options.availableBytes,
    requiredBytes,
    sufficient: options.availableBytes >= requiredBytes,
  };
}

export interface SpaceMeasurement {
  readonly availableBytes: number;
  readonly blockSize: number;
}

export async function measureSpace(path: string): Promise<SpaceMeasurement> {
  const stats = await statfs(path);
  return { availableBytes: stats.bavail * stats.bsize, blockSize: stats.bsize };
}

/** Clones one file's extents, and fails when the filesystem cannot share them. */
export async function cloneFile(from: string, to: string): Promise<void> {
  await copyFile(from, to, constants.COPYFILE_FICLONE_FORCE);
}

const CLONE_UNSUPPORTED = new Set(['ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EINVAL', 'ENOSYS', 'ENOTTY']);

export interface CopyResult {
  readonly path: string;
  readonly method: CopyMethod;
  readonly copyMilliseconds: number;
  readonly verifyMilliseconds: number;
  readonly listing: TreeListing;
}

export class InsufficientSpaceError extends PlatformError {
  readonly plan: SpacePlan;

  constructor(plan: SpacePlan) {
    super('DATASET_UNAVAILABLE', 'Not enough free space for the search engine working copy.', {
      details: { availableBytes: plan.availableBytes, requiredBytes: plan.requiredBytes },
      retryable: true,
    });
    this.plan = plan;
  }
}

/**
 * Copies a sealed, read-only engine tree into a disposable working copy, transactionally.
 *
 * The copy is written to a private incoming directory, verified against the manifest's digest,
 * sizes and counts, and only then renamed into place, so a partial or corrupt copy can never be
 * started. Where the filesystem can clone extents the copy costs almost no space; otherwise it
 * falls back to a full copy, and the method is reported. When a full copy would not fit, only a
 * clone is attempted, and anything that would need real space fails as insufficient space.
 *
 * Free space is measured with every other working copy still in place, so a copy that is kept while
 * its replacement is built is already accounted for: the plan never counts on space it would free.
 */
export async function copySealedTree(options: {
  readonly source: string;
  readonly workRoot: string;
  readonly name: string;
  readonly expected: ExpectedTree;
  readonly reserveBytes: number;
  /** Called between the copy and its verification; tests use it to tamper deterministically. */
  readonly afterCopy?: ((path: string) => Promise<void>) | undefined;
  /** Test seam: how free space is measured. */
  readonly measureSpace?: ((path: string) => Promise<SpaceMeasurement>) | undefined;
  /** Test seam: how one file is cloned. */
  readonly cloneFile?: ((from: string, to: string) => Promise<void>) | undefined;
}): Promise<CopyResult> {
  const incomingRoot = join(options.workRoot, 'incoming');
  const treesRoot = join(options.workRoot, 'trees');
  await mkdir(incomingRoot, { mode: 0o700, recursive: true });
  await mkdir(treesRoot, { mode: 0o700, recursive: true });

  const space = await (options.measureSpace ?? measureSpace)(options.workRoot);
  const clone = options.cloneFile ?? cloneFile;
  const plan = planSpace({
    availableBytes: space.availableBytes,
    blockSize: space.blockSize,
    reserveBytes: options.reserveBytes,
    tree: options.expected,
  });

  const incoming = await mkdtemp(join(incomingRoot, 'load-'));
  try {
    const started = performance.now();
    // Links and special files are refused here, before anything is copied.
    const source = await listTree(options.source, { hash: false });
    let method: CopyMethod = 'clone';
    for (const entry of source.entries) {
      const from = join(options.source, ...entry.path.split('/'));
      const to = join(incoming, ...entry.path.split('/'));
      if (entry.type === 'directory') {
        await mkdir(to, { mode: SEALED_DIRECTORY_MODE });
        continue;
      }
      if (method === 'clone') {
        try {
          await clone(from, to);
          continue;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code ?? '';
          if (!CLONE_UNSUPPORTED.has(code)) throw error;
          if (!plan.sufficient) throw new InsufficientSpaceError(plan);
          method = 'copy';
        }
      }
      await copyFile(from, to);
    }
    const copyMilliseconds = performance.now() - started;

    await options.afterCopy?.(incoming);

    const verifyStarted = performance.now();
    const listing = await listTree(incoming, { hash: true });
    const { expected } = options;
    if (
      listing.digest !== expected.treeDigest ||
      listing.bytes !== expected.bytes ||
      listing.files !== expected.files ||
      listing.directories !== expected.directories
    ) {
      throw new PlatformError(
        'VALIDATION_FAILED',
        'The search engine working copy does not match the sealed snapshot.',
      );
    }
    const verifyMilliseconds = performance.now() - verifyStarted;

    const path = join(treesRoot, options.name);
    await rename(incoming, path);
    return { copyMilliseconds, listing, method, path, verifyMilliseconds };
  } catch (error) {
    await rm(incoming, { force: true, recursive: true });
    if ((error as NodeJS.ErrnoException).code === 'ENOSPC') throw new InsufficientSpaceError(plan);
    throw error;
  }
}

/** Removes every working copy and any interrupted copy. The sealed slot is never touched. */
export async function resetWorkRoot(workRoot: string): Promise<void> {
  for (const directory of ['trees', 'incoming', 'tmp']) {
    await rm(join(workRoot, directory), { force: true, recursive: true });
  }
  for (const directory of ['trees', 'incoming', 'tmp', 'home']) {
    await mkdir(join(workRoot, directory), { mode: 0o700, recursive: true });
  }
}

/** Removes one working copy that no running engine uses. */
export async function removeWorkingCopy(tree: string): Promise<void> {
  await rm(tree, { force: true, recursive: true });
}

/** Empties the engine's temporary directory; only while no engine is running. */
export async function clearTemporary(workRoot: string): Promise<void> {
  await rm(join(workRoot, 'tmp'), { force: true, recursive: true });
  await mkdir(join(workRoot, 'tmp'), { mode: 0o700, recursive: true });
}
