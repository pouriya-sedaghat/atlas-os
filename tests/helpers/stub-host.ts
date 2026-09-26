import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';

import type { HostStatus } from '../../packages/atlas-os/src/internal/search/protocol.js';
import type { SlotName, SnapshotManifest } from '../../packages/atlas-os/src/snapshot.js';
import { searchComponentOf } from '../../packages/atlas-os/src/snapshot.js';

export type StubBehaviour =
  | 'ready'
  | 'loading'
  | 'insufficient_space'
  | 'hang'
  | 'oversized'
  | 'malformed'
  | 'wrong_generation'
  | 'hold';

const FEATURES = {
  features: [
    {
      geometry: { coordinates: [51.389, 35.6892], type: 'Point' },
      properties: {
        countrycode: 'IR',
        name: 'تهران',
        osm_id: 8_000_000_000_000_001,
        osm_key: 'place',
        osm_type: 'N',
        osm_value: 'city',
        type: 'city',
      },
      type: 'Feature',
    },
  ],
  type: 'FeatureCollection',
};

/**
 * A programmable stand-in for a per-slot search host, speaking the private protocol directly.
 * Used where a test needs a host that misbehaves in one precise way.
 */
export class StubHost {
  behaviour: StubBehaviour = 'ready';
  queries = 0;
  readonly loadId = randomUUID();
  readonly #held: (() => void)[] = [];
  readonly #server: Server;
  readonly #manifest: SnapshotManifest;
  readonly #slot: SlotName;

  private constructor(server: Server, manifest: SnapshotManifest, slot: SlotName) {
    this.#server = server;
    this.#manifest = manifest;
    this.#slot = slot;
  }

  static async start(manifest: SnapshotManifest, slot: SlotName = 'blue'): Promise<StubHost> {
    const handlers: { handle?: (url: string, response: ServerResponse) => void } = {};
    const server = createServer((request, response) =>
      handlers.handle!(request.url ?? '/', response),
    );
    const stub = new StubHost(server, manifest, slot);
    handlers.handle = (url, response) => stub.handle(url, response);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return stub;
  }

  get url(): URL {
    const { port } = this.#server.address() as { port: number };
    return new URL(`http://127.0.0.1:${port}/`);
  }

  get held(): number {
    return this.#held.length;
  }

  release(): void {
    for (const release of this.#held.splice(0)) release();
  }

  status(): HostStatus {
    const search = searchComponentOf(this.#manifest)!;
    const ready = !['loading', 'insufficient_space'].includes(this.behaviour);
    return {
      diagnostics: {
        copyMethod: 'copy',
        copyMilliseconds: 1,
        heapLimit: '64m',
        lastEngineExit: null,
        memoryLimitBytes: null,
        pidsLimit: null,
        residentBytes: null,
        residentPeakBytes: null,
        startupMilliseconds: 1,
        treeBytes: 1,
        verifyMilliseconds: 1,
      },
      load: ready
        ? {
            engineImportDate: search.engine.importDate,
            generationMarker:
              this.behaviour === 'wrong_generation'
                ? `sha256:${'0'.repeat(64)}`
                : search.generationMarker,
            loadId: this.loadId,
            slot: this.#slot,
            snapshotId: this.#manifest.snapshotId,
          }
        : null,
      pending: ready
        ? null
        : {
            snapshotId: this.#manifest.snapshotId,
            state: this.behaviour === 'insufficient_space' ? 'insufficient_space' : 'loading',
          },
      slot: this.#slot,
      state:
        this.behaviour === 'insufficient_space'
          ? 'insufficient_space'
          : ready
            ? 'ready'
            : 'loading',
    };
  }

  async close(): Promise<void> {
    this.release();
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  private handle(url: string, response: ServerResponse): void {
    const path = new URL(url, 'http://stub.invalid').pathname;
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (path === '/v1/status') {
      json(200, this.status());
      return;
    }
    this.queries += 1;
    const status = this.status();
    if (status.state !== 'ready') {
      json(503, status);
      return;
    }
    const answer = () => {
      const headers = {
        'x-atlas-generation': status.load!.generationMarker,
        'x-atlas-load-id': this.loadId,
        'x-atlas-snapshot': this.#manifest.snapshotId,
      };
      if (this.behaviour === 'oversized') {
        json(
          200,
          `{"type":"FeatureCollection","features":[],"pad":"${'x'.repeat(2 * 1024 * 1024)}"}`,
          headers,
        );
      } else if (this.behaviour === 'malformed') {
        json(
          200,
          { error: 'java.lang.IllegalStateException at de.komoot.photon', type: 'Oops' },
          headers,
        );
      } else {
        json(200, FEATURES, headers);
      }
    };
    if (this.behaviour === 'hang') return;
    if (this.behaviour === 'hold') {
      this.#held.push(answer);
      return;
    }
    answer();
  }
}
