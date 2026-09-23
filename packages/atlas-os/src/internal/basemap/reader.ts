import type { FileHandle } from 'node:fs/promises';
import { open } from 'node:fs/promises';

import type {
  BasemapResourceReader,
  BasemapResourceRequest,
  BasemapResourceResult,
} from '../../contracts.js';
import { PlatformError } from '../../errors.js';
import type { SlotName } from '../../snapshot.js';
import { contentRange, parseRangeHeader, unsatisfiedContentRange } from '../http/range.js';
import { resolveWithinRoot } from '../fs/paths.js';
import type { SnapshotStore } from '../snapshot/store.js';
import { resolveBasemapResource } from './resources.js';

/**
 * Versioned resource URLs are immutable: activating a snapshot mints new URLs rather than
 * changing the bytes behind an existing one, so a client may cache them indefinitely.
 */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

interface Addressable {
  readonly slot: SlotName;
  readonly snapshotId: string;
}

/**
 * Serves basemap resources out of the snapshots that are currently published.
 *
 * Three independent guards stand between a request and the filesystem: an allowlist that names
 * every servable resource shape, a decoder that rejects traversal before any path is built, and
 * a `realpath` containment check that defeats a symbolic link pointing out of the snapshot.
 *
 * A fourth guard protects the *identity* of an immutable URL. Slots are directories that a later
 * preparation may replace by rename, so checking the active pointer and then opening a path by
 * name would leave a window in which bytes from a different snapshot could be returned under a
 * URL that promises to be immutable. Instead the file is opened first and the snapshot's identity
 * is confirmed afterwards, from the manifest, before a single byte is streamed — and the response
 * streams from the open handle rather than from the path, so a rename mid-response cannot swap
 * the content underneath it. The check fails closed: if the slot changed at any point, the
 * request is refused rather than answered from the wrong snapshot.
 */
export class LocalBasemapResourceReader implements BasemapResourceReader {
  readonly #store: SnapshotStore;

  constructor(store: SnapshotStore) {
    this.#store = store;
  }

  /**
   * Snapshots that may be addressed: the active one, and the previous one it replaced.
   *
   * Retaining the previous snapshot keeps already-loaded browser sessions working across an
   * activation, and keeps a rollback target reachable. Staged and candidate snapshots are never
   * addressable.
   */
  async #addressable(): Promise<readonly Addressable[]> {
    const pointer = await this.#store.readActivePointer();
    if (pointer === undefined) return [];
    const addressable: Addressable[] = [{ slot: pointer.slot, snapshotId: pointer.snapshotId }];
    if (pointer.previous !== null) {
      addressable.push({
        slot: pointer.previous.slot,
        snapshotId: pointer.previous.snapshotId,
      });
    }
    return addressable;
  }

  /** Confirms the slot still holds the snapshot the request named. */
  async #stillHolds(target: Addressable): Promise<boolean> {
    const manifest = await this.#store.readManifest(target.slot).catch(() => undefined);
    if (manifest === undefined || manifest.snapshotId !== target.snapshotId) return false;
    const current = await this.#addressable();
    return current.some(
      (entry) => entry.slot === target.slot && entry.snapshotId === target.snapshotId,
    );
  }

  async read(request: BasemapResourceRequest): Promise<BasemapResourceResult> {
    let resource;
    try {
      resource = resolveBasemapResource(request.path);
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'INVALID_REQUEST') {
        return { outcome: 'invalid_request', reason: error.message };
      }
      return { outcome: 'not_found' };
    }

    const addressable = await this.#addressable();
    if (addressable.length === 0) return { outcome: 'unavailable' };

    const target = addressable.find((entry) => entry.snapshotId === resource.snapshotId);
    if (target === undefined) return { outcome: 'not_found' };

    const slotRoot = this.#store.slotRoot(target.slot);
    let absolutePath: string;
    try {
      absolutePath = await resolveWithinRoot(slotRoot, resource.segments);
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'INVALID_REQUEST') {
        return { outcome: 'invalid_request', reason: error.message };
      }
      return { outcome: 'not_found' };
    }

    let handle: FileHandle;
    try {
      handle = await open(absolutePath, 'r');
    } catch {
      return { outcome: 'not_found' };
    }

    try {
      // Identity is confirmed only after the handle is held. From here the response is served
      // from this handle, so replacing the slot cannot change what it returns.
      if (!(await this.#stillHolds(target))) {
        await handle.close();
        return { outcome: 'not_found' };
      }

      const details = await handle.stat();
      if (!details.isFile()) {
        await handle.close();
        return { outcome: 'not_found' };
      }

      const size = details.size;
      const range = parseRangeHeader(request.rangeHeader, size);

      if (range.kind === 'unsatisfiable') {
        await handle.close();
        return {
          contentRange: unsatisfiedContentRange(size),
          contentType: resource.contentType,
          outcome: 'range_not_satisfiable',
        };
      }

      if (request.method === 'HEAD') {
        const headers =
          range.kind === 'satisfiable'
            ? {
                acceptRanges: 'bytes' as const,
                cacheControl: IMMUTABLE_CACHE_CONTROL,
                contentLength: range.end - range.start + 1,
                contentRange: contentRange(range.start, range.end, size),
                contentType: resource.contentType,
              }
            : {
                acceptRanges: 'bytes' as const,
                cacheControl: IMMUTABLE_CACHE_CONTROL,
                contentLength: size,
                contentType: resource.contentType,
              };
        await handle.close();
        return {
          body: null,
          headers,
          outcome: 'ok',
          status: range.kind === 'satisfiable' ? 206 : 200,
        };
      }

      if (range.kind === 'satisfiable') {
        const length = range.end - range.start + 1;
        return {
          // A bounded read from the pinned handle: only the requested window is ever buffered,
          // so serving a byte range out of a multi-gigabyte archive costs a few kilobytes.
          body: handle.createReadStream({ autoClose: true, end: range.end, start: range.start }),
          headers: {
            acceptRanges: 'bytes',
            cacheControl: IMMUTABLE_CACHE_CONTROL,
            contentLength: length,
            contentRange: contentRange(range.start, range.end, size),
            contentType: resource.contentType,
          },
          outcome: 'ok',
          status: 206,
        };
      }

      return {
        body: handle.createReadStream({ autoClose: true }),
        headers: {
          acceptRanges: 'bytes',
          cacheControl: IMMUTABLE_CACHE_CONTROL,
          contentLength: size,
          contentType: resource.contentType,
        },
        outcome: 'ok',
        status: 200,
      };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }
}
