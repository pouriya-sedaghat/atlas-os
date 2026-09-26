import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { SearchHostConfig } from '../../packages/atlas-os/src/internal/search/host/config.js';
import type { SpaceMeasurement } from '../../packages/atlas-os/src/internal/search/host/copy.js';
import type { EngineCommandFactory } from '../../packages/atlas-os/src/internal/search/host/engine.js';
import { SearchEngineHost } from '../../packages/atlas-os/src/internal/search/host/host.js';
import type { HostStatus } from '../../packages/atlas-os/src/internal/search/protocol.js';
import { SnapshotStore } from '../../packages/atlas-os/src/internal/snapshot/store.js';
import type { SlotName, SnapshotManifest } from '../../packages/atlas-os/src/snapshot.js';

/** Resolved both as an ES module (tests) and as CommonJS (the browser suite's launchers). */
export const FAKE_ENGINE = resolve(
  typeof __dirname === 'string' ? __dirname : import.meta.dirname,
  'fake-engine.mjs',
);

/** Starts the engine stand-in exactly as the host starts the real engine: a child process. */
export const fakeEngineCommand: EngineCommandFactory = ({ dataDirectory, port }) => ({
  args: [
    FAKE_ENGINE,
    'serve',
    '-data-dir',
    dataDirectory,
    '-listen-ip',
    '127.0.0.1',
    '-listen-port',
    String(port),
  ],
  executable: process.execPath,
});

export async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolvePort(port));
    });
  });
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await delay(20);
  }
  throw new Error('Timed out waiting for a condition.');
}

/**
 * A store whose manifest a test can hold still while it rewrites a slot in several steps, so the
 * host sees the change at once, as it sees a promotion. Nothing else about the store changes.
 */
class HoldableStore extends SnapshotStore {
  #held: Promise<SnapshotManifest | undefined> | undefined;

  hold(slot: SlotName): void {
    this.#held = super.readManifest(slot);
  }

  release(): void {
    this.#held = undefined;
  }

  override readManifest(slot: SlotName): Promise<SnapshotManifest | undefined> {
    return this.#held ?? super.readManifest(slot);
  }
}

export interface TestHost {
  readonly host: SearchEngineHost;
  readonly url: URL;
  readonly enginePort: number;
  readonly workRoot: string;
  readonly config: SearchHostConfig;
  status(): Promise<HostStatus>;
  /** Waits until the host serves a load other than `except`, and returns it. */
  ready(except?: string): Promise<NonNullable<HostStatus['load']>>;
  /** Runs `change` while the host keeps seeing the slot as it was, then shows the result at once. */
  changeSlot<T>(change: () => Promise<T>): Promise<T>;
  /** Sends a control action to the engine stand-in behind this host. */
  control(
    action: 'hold' | 'release' | 'exit' | 'kill' | 'state',
    parameters?: Readonly<Record<string, string>>,
  ): Promise<{ held: number; pid: number }>;
  close(): Promise<void>;
}

export async function startTestHost(options: {
  readonly dataRoot: string;
  readonly slot: SlotName;
  readonly workRoot?: string;
  readonly listenPort?: number;
  readonly enginePort?: number;
  readonly config?: Partial<SearchHostConfig>;
  readonly afterCopy?: (path: string) => Promise<void>;
  readonly measureSpace?: (path: string) => Promise<SpaceMeasurement>;
  readonly cloneFile?: (from: string, to: string) => Promise<void>;
  readonly cgroupRoot?: string;
  readonly engineCommand?: EngineCommandFactory;
}): Promise<TestHost> {
  const ownedWork = options.workRoot === undefined;
  const workRoot = options.workRoot ?? (await mkdtemp(join(tmpdir(), 'atlas-os-engine-work-')));
  const enginePort = options.enginePort ?? (await freePort());
  const config: SearchHostConfig = {
    engineArchive: '/unused/engine.jar',
    enginePort,
    fenceMs: 0,
    heap: '64m',
    javaExecutable: 'java',
    listenAddress: '127.0.0.1',
    listenPort: options.listenPort ?? 0,
    pollMs: 50,
    queryTimeoutMs: 5_000,
    reserveBytes: 0,
    retryMs: 200,
    slot: options.slot,
    startupTimeoutMs: 20_000,
    workRoot,
    ...options.config,
  };
  const store = new HoldableStore(options.dataRoot);
  const host = new SearchEngineHost({
    afterCopy: options.afterCopy,
    cgroupRoot: options.cgroupRoot,
    cloneFile: options.cloneFile,
    config,
    engineCommand: options.engineCommand ?? fakeEngineCommand,
    measureSpace: options.measureSpace,
    region: 'iran',
    store,
  });
  const address = await host.start();
  const url = new URL(`http://127.0.0.1:${address.port}/`);

  const status = async (): Promise<HostStatus> => {
    const response = await fetch(new URL('/v1/status', url));
    return (await response.json()) as HostStatus;
  };

  return {
    changeSlot: async (change) => {
      store.hold(options.slot);
      try {
        return await change();
      } finally {
        store.release();
      }
    },
    close: async () => {
      await host.close();
      if (ownedWork) await rm(workRoot, { force: true, recursive: true });
    },
    config,
    control: async (action, parameters = {}) => {
      const query = new URLSearchParams({ action, ...parameters });
      const response = await fetch(`http://127.0.0.1:${enginePort}/__control?${query}`);
      return (await response.json()) as { held: number; pid: number };
    },
    enginePort,
    host,
    ready: (except) =>
      waitFor(async () => {
        const current = await status();
        return current.state === 'ready' && current.load !== null && current.load.loadId !== except
          ? current.load
          : undefined;
      }),
    status,
    url,
    workRoot,
  };
}
