import { hostname } from 'node:os';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { PlatformError } from '../../errors.js';
import type { ActivePointer, SlotName, SnapshotManifest } from '../../snapshot.js';
import { SLOTS, parseActivePointer, parseSnapshotManifest } from '../../snapshot.js';
import { writeJsonAtomic } from '../fs/atomic.js';
import { MANIFEST_FILE } from '../basemap/layout.js';

const ACTIVE_POINTER_FILE = 'active.json';
const SLOTS_DIRECTORY = 'slots';
const STAGING_DIRECTORY = 'tmp';
const LOCK_DIRECTORY = 'locks';
const LOCK_FILE = 'provisioning.lock';

/**
 * Mode a published slot root must carry.
 *
 * `mkdtemp` creates the staging tree as `0700`, which is right while a preparation is still
 * private, but a slot is read by the serving containers, which run as a different, non-root user.
 * Without the traverse bit they cannot reach the manifest or the archive inside, and the dataset
 * resolves as unavailable even though the pointer and the files themselves are readable.
 */
export const PUBLISHED_SLOT_MODE = 0o755;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

export interface SnapshotSummaryRecord {
  readonly manifest: SnapshotManifest;
  readonly slot: SlotName;
}

/**
 * Owns the on-disk blue/green layout.
 *
 * Only two things ever change after a snapshot is written: the pointer file, replaced by an
 * atomic rename, and the inactive slot, replaced wholesale by an atomic directory rename. The
 * active slot is never written to, so a reader always sees a complete, consistent snapshot.
 */
export class SnapshotStore {
  readonly #dataRoot: string;

  constructor(dataRoot: string) {
    this.#dataRoot = resolve(dataRoot);
  }

  get dataRoot(): string {
    return this.#dataRoot;
  }

  get activePointerPath(): string {
    return join(this.#dataRoot, ACTIVE_POINTER_FILE);
  }

  slotRoot(slot: SlotName): string {
    return join(this.#dataRoot, SLOTS_DIRECTORY, slot);
  }

  manifestPath(slot: SlotName): string {
    return join(this.slotRoot(slot), MANIFEST_FILE);
  }

  async ensureLayout(): Promise<void> {
    await mkdir(join(this.#dataRoot, SLOTS_DIRECTORY), { recursive: true });
    await mkdir(join(this.#dataRoot, STAGING_DIRECTORY), { recursive: true });
    await mkdir(join(this.#dataRoot, LOCK_DIRECTORY), { recursive: true });
  }

  /** The active pointer, or `undefined` when no dataset has ever been activated. */
  async readActivePointer(): Promise<ActivePointer | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.activePointerPath, 'utf8');
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw new PlatformError('DATASET_UNAVAILABLE', 'Active snapshot pointer is unreadable.', {
        cause: error,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new PlatformError('VALIDATION_FAILED', 'Active snapshot pointer is not valid JSON.', {
        cause: error,
      });
    }
    return parseActivePointer(parsed);
  }

  async readManifest(slot: SlotName): Promise<SnapshotManifest | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.manifestPath(slot), 'utf8');
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw new PlatformError('DATASET_UNAVAILABLE', 'Snapshot manifest is unreadable.', {
        cause: error,
        details: { slot },
      });
    }
    return parseSnapshotManifest(JSON.parse(raw));
  }

  async list(): Promise<readonly SnapshotSummaryRecord[]> {
    const records: SnapshotSummaryRecord[] = [];
    for (const slot of SLOTS) {
      const manifest = await this.readManifest(slot);
      if (manifest !== undefined) records.push({ manifest, slot });
    }
    return records;
  }

  /** Locates the slot holding a snapshot ID, if any slot does. */
  async findSlot(snapshotId: string): Promise<SlotName | undefined> {
    for (const record of await this.list()) {
      if (record.manifest.snapshotId === snapshotId) return record.slot;
    }
    return undefined;
  }

  /** The slot a preparation may overwrite: whichever one is not serving traffic. */
  async inactiveSlot(): Promise<SlotName> {
    const active = await this.readActivePointer();
    if (active === undefined) return 'blue';
    return active.slot === 'blue' ? 'green' : 'blue';
  }

  async createStagingDirectory(): Promise<string> {
    await this.ensureLayout();
    return mkdtemp(join(this.#dataRoot, STAGING_DIRECTORY, 'prepare-'));
  }

  /**
   * Replaces the inactive slot with a staged tree.
   *
   * Refuses to touch the active slot, so a bug in a caller cannot destroy the snapshot that is
   * currently serving requests.
   */
  async promoteStaging(stagingDirectory: string, slot: SlotName): Promise<void> {
    const active = await this.readActivePointer();
    if (active !== undefined && active.slot === slot) {
      throw new PlatformError('CONFLICT', 'Refusing to overwrite the active snapshot slot.', {
        details: { slot },
      });
    }
    const target = this.slotRoot(slot);
    await mkdir(join(this.#dataRoot, SLOTS_DIRECTORY), { recursive: true });
    await rm(target, { force: true, recursive: true });
    // Opened up while the tree is still staging, so the rename that publishes it is the only
    // step left: a crash here can never leave a promoted slot the serving user cannot enter.
    await chmod(stagingDirectory, PUBLISHED_SLOT_MODE);
    await rename(stagingDirectory, target);
  }

  /**
   * Publishes a snapshot by replacing the pointer file atomically. The previous pointer is
   * retained inside the new one so a rollback has somewhere to go.
   */
  async writeActivePointer(snapshotId: string, slot: SlotName): Promise<ActivePointer> {
    const current = await this.readActivePointer();
    const pointer: ActivePointer = {
      activatedAt: new Date().toISOString(),
      previous:
        current === undefined
          ? null
          : {
              activatedAt: current.activatedAt,
              slot: current.slot,
              snapshotId: current.snapshotId,
            },
      schemaVersion: 1,
      slot,
      snapshotId,
    };
    await this.ensureLayout();
    await writeJsonAtomic(this.activePointerPath, pointer);
    return pointer;
  }

  /**
   * Runs `operation` while holding an exclusive provisioning lock, so two preparations or an
   * activation racing a preparation cannot interleave.
   */
  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureLayout();
    const lockPath = join(this.#dataRoot, LOCK_DIRECTORY, LOCK_FILE);
    const holder = JSON.stringify({
      hostname: hostname(),
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });

    try {
      await writeFile(lockPath, `${holder}\n`, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readFile(lockPath, 'utf8').catch(() => '{}');
      throw new PlatformError('CONFLICT', 'Another dataset operation is already running.', {
        details: { holder: existing.trim(), lockPath },
        retryable: true,
      });
    }

    try {
      return await operation();
    } finally {
      await unlink(lockPath).catch(() => undefined);
    }
  }

  async discardStaging(stagingDirectory: string): Promise<void> {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
}
