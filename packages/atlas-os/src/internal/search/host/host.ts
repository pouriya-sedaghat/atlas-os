import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { GeographicBounds } from '../../../contracts.js';
import { PlatformError } from '../../../errors.js';
import type { SearchComponent, SnapshotManifest } from '../../../snapshot.js';
import { searchComponentOf } from '../../../snapshot.js';
import type { SnapshotStore } from '../../snapshot/store.js';
import type { HostDiagnostics, HostLoad, HostState, HostStatus } from '../protocol.js';
import {
  HOST_HEADERS,
  HOST_REVERSE_PARAMETERS,
  HOST_ROUTES,
  HOST_SEARCH_PARAMETERS,
} from '../protocol.js';
import { hasControlCharacter } from '../request.js';
import type { SearchHostConfig } from './config.js';
import type { CopyMethod, SpaceMeasurement } from './copy.js';
import {
  InsufficientSpaceError,
  clearTemporary,
  copySealedTree,
  removeWorkingCopy,
  resetWorkRoot,
} from './copy.js';
import type { EngineCommandFactory } from './engine.js';
import { EngineProcess } from './engine.js';
import type { EngineExitReason, LimitEvents } from './limits.js';
import { CGROUP_ROOT, classifyEngineExit, readContainerLimits, readLimitEvents } from './limits.js';
import {
  LoadFailure,
  awaitEngine,
  engineQuery,
  parseCollection,
  verifyCanary,
  verifyProbes,
} from './verify.js';

export interface SearchEngineHostOptions {
  readonly config: SearchHostConfig;
  readonly region: string;
  readonly store: SnapshotStore;
  readonly engineCommand: EngineCommandFactory;
  readonly log?: ((event: Readonly<Record<string, unknown>>) => void) | undefined;
  /** Test seam: runs between copying and verifying a working copy. */
  readonly afterCopy?: ((path: string) => Promise<void>) | undefined;
  /** Test seam: how the work volume's free space is measured. */
  readonly measureSpace?: ((path: string) => Promise<SpaceMeasurement>) | undefined;
  /** Test seam: how one file of a working copy is cloned. */
  readonly cloneFile?: ((from: string, to: string) => Promise<void>) | undefined;
  /** Test seam: where the kernel reports this container's limits. */
  readonly cgroupRoot?: string | undefined;
}

/** The load behind an open gate: the only one any request can reach. */
interface ActiveLoad {
  readonly identity: HostLoad;
  readonly engine: EngineProcess;
  readonly bounds: GeographicBounds;
}

/** The engine process and working copy on this host, whether or not its gate is open. */
interface ResidentLoad {
  readonly key: string;
  readonly snapshotId: string;
  readonly search: SearchComponent;
  readonly bounds: GeographicBounds;
  readonly engine: EngineProcess;
  readonly tree: string;
  readonly treeBytes: number;
  /** The kernel's limit counters when this engine started, to explain an unexpected exit. */
  readonly events: LimitEvents;
}

/** What the slot currently holds, reduced to what makes one generation different from another. */
type SlotReading =
  | { readonly kind: 'empty'; readonly key: string }
  | { readonly kind: 'invalid'; readonly key: string; readonly snapshotId: string | null }
  | {
      readonly kind: 'search';
      readonly key: string;
      readonly manifest: SnapshotManifest;
      readonly search: SearchComponent;
    };

class Superseded extends Error {}

const DECIMAL = /^-?(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,15})?$/;

function readingKey(manifest: SnapshotManifest, search: SearchComponent): string {
  return [
    manifest.snapshotId,
    search.generationMarker,
    search.engine.importDate,
    search.engine.treeDigest,
  ].join('\n');
}

function send(
  response: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(body);
}

type ParsedParameters = Readonly<Record<string, string>>;

/**
 * Strict private parameters. The API has already validated the public request; this refuses
 * anything else that reaches the host so it can never become a general engine proxy.
 */
function parseHostParameters(url: URL, route: 'search' | 'reverse'): ParsedParameters | undefined {
  const allowed: readonly string[] =
    route === 'search' ? HOST_SEARCH_PARAMETERS : HOST_REVERSE_PARAMETERS;
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || key in values) return undefined;
    values[key] = value;
  }
  const decimal = (value: string | undefined, limit: number) =>
    value !== undefined && DECIMAL.test(value) && Math.abs(Number(value)) <= limit;
  if (values['lang'] !== 'fa' && values['lang'] !== 'en') return undefined;
  const limit = values['limit'];
  const maxLimit = route === 'search' ? 20 : 5;
  if (limit === undefined || !/^[1-9][0-9]?$/.test(limit) || Number(limit) > maxLimit) {
    return undefined;
  }
  const hasLat = values['lat'] !== undefined;
  const hasLon = values['lon'] !== undefined;
  if (hasLat !== hasLon) return undefined;
  if (hasLat && !(decimal(values['lat'], 90) && decimal(values['lon'], 180))) return undefined;
  if (route === 'reverse') return hasLat ? values : undefined;

  const query = values['q'];
  if (
    query === undefined ||
    query.trim().length === 0 ||
    Buffer.byteLength(query, 'utf8') > 400 ||
    hasControlCharacter(query)
  ) {
    return undefined;
  }
  const bbox = values['bbox'];
  if (bbox !== undefined) {
    const parts = bbox.split(',');
    if (parts.length !== 4) return undefined;
    const [west, south, east, north] = parts;
    if (
      !decimal(west, 180) ||
      !decimal(east, 180) ||
      !decimal(south, 90) ||
      !decimal(north, 90) ||
      !(Number(west) < Number(east) && Number(south) < Number(north))
    ) {
      return undefined;
    }
  }
  return values;
}

/**
 * The private control plane in front of one slot's search engine.
 *
 * It loads the slot's sealed engine database into a disposable working copy, starts the engine on
 * loopback, proves the running engine serves exactly that generation, and only then opens its gate
 * under a fresh random load identity. Every answer is checked against that identity before the
 * engine is asked, after it answers and immediately before responding. Any transition closes the
 * gate first and aborts in-flight engine requests, destroying their connections.
 *
 * A transition never destroys the resident engine or its working copy before a replacement exists.
 * The replacement is copied and verified beside it, with free space measured while both are on
 * disk. Only one engine can hold the loopback ports, so the switch happens at a single safe point:
 * once the verified replacement is still the slot's generation, the resident engine is stopped,
 * its files are removed, and the replacement starts under a new engine process and connection pool.
 * When the replacement fails, the resident load is kept intact behind its closed gate: if the slot
 * again holds its generation, it is proved once more and reopened under a new identity; otherwise
 * it is kept only until it can be removed safely, and the new generation is reported unavailable.
 * A restarted host discards every working copy and always has a new identity.
 */
export class SearchEngineHost {
  readonly #options: SearchEngineHostOptions;
  readonly #config: SearchHostConfig;
  #server: Server | undefined;
  #state: HostState = 'loading';
  #load: ActiveLoad | null = null;
  #resident: ResidentLoad | null = null;
  #pending: HostStatus['pending'] = { snapshotId: null, state: 'loading' };
  #diagnostics: Omit<HostDiagnostics, 'residentBytes' | 'residentPeakBytes'>;
  #attemptedKey: string | null = null;
  #retryAt: number | null = null;
  #running: Promise<void> | null = null;
  #rerun = false;
  #closing = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: SearchEngineHostOptions) {
    this.#options = options;
    this.#config = options.config;
    this.#diagnostics = {
      copyMethod: null,
      copyMilliseconds: null,
      heapLimit: options.config.heap,
      lastEngineExit: null,
      memoryLimitBytes: null,
      pidsLimit: null,
      startupMilliseconds: null,
      treeBytes: null,
      verifyMilliseconds: null,
    };
  }

  /** Starts serving status immediately and begins loading the slot in the background. */
  async start(): Promise<AddressInfo> {
    await resetWorkRoot(this.#config.workRoot);
    const limits = await readContainerLimits(this.#cgroupRoot);
    this.#diagnostics = {
      ...this.#diagnostics,
      memoryLimitBytes: limits.memoryBytes,
      pidsLimit: limits.pids,
    };
    this.#log('limits', {
      heapLimit: this.#config.heap,
      memoryLimitBytes: limits.memoryBytes,
      pidsLimit: limits.pids,
    });
    const server = createServer((request, response) => {
      void this.#handle(request, response).catch(() => {
        if (!response.headersSent) send(response, 500, '{"error":"internal"}');
        else response.destroy();
      });
    });
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.#config.listenPort, this.#config.listenAddress, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.#schedule();
    this.#poll();
    return server.address() as AddressInfo;
  }

  async close(): Promise<void> {
    this.#closing = true;
    clearTimeout(this.#timer);
    this.#closeGate();
    await this.#running?.catch(() => undefined);
    await this.#resident?.engine.stop();
    const server = this.#server;
    if (server !== undefined) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  async status(): Promise<HostStatus> {
    const memory = (await this.#resident?.engine.memory()) ?? null;
    return {
      diagnostics: {
        ...this.#diagnostics,
        residentBytes: memory?.resident ?? null,
        residentPeakBytes: memory?.peak ?? null,
      },
      load: this.#load?.identity ?? null,
      pending: this.#pending,
      slot: this.#config.slot,
      state: this.#state,
    };
  }

  get #cgroupRoot(): string {
    return this.#options.cgroupRoot ?? CGROUP_ROOT;
  }

  #log(event: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.#options.log?.({ event, service: 'search-host', slot: this.#config.slot, ...fields });
  }

  #schedule(): void {
    if (this.#closing) return;
    this.#timer = setTimeout(() => {
      this.#poll();
      this.#schedule();
    }, this.#config.pollMs);
    this.#timer.unref();
  }

  /** Re-reads the slot and starts a transition when it holds a different generation. */
  #poll(): void {
    if (this.#closing) return;
    void this.#read().then((reading) => {
      const retry =
        (this.#state === 'failed' ||
          this.#state === 'insufficient_space' ||
          (this.#state === 'idle' && this.#resident !== null)) &&
        this.#retryAt !== null &&
        Date.now() >= this.#retryAt;
      if (reading.key !== this.#attemptedKey || retry) this.#transition();
    });
  }

  async #read(): Promise<SlotReading> {
    let manifest: SnapshotManifest | undefined;
    try {
      manifest = await this.#options.store.readManifest(this.#config.slot);
    } catch {
      return { key: 'invalid', kind: 'invalid', snapshotId: null };
    }
    if (manifest === undefined) return { key: 'empty', kind: 'empty' };
    const search = searchComponentOf(manifest);
    if (search === undefined) return { key: `basemap-only\n${manifest.snapshotId}`, kind: 'empty' };
    if (manifest.region !== this.#options.region) {
      return { key: `foreign\n${manifest.snapshotId}`, kind: 'invalid', snapshotId: null };
    }
    return { key: readingKey(manifest, search), kind: 'search', manifest, search };
  }

  /** Runs one transition at a time; a request for another while one runs re-runs it after. */
  #transition(): void {
    if (this.#closing) return;
    if (this.#running !== null) {
      this.#rerun = true;
      return;
    }
    this.#running = (async () => {
      do {
        this.#rerun = false;
        await this.#reload();
      } while (this.#rerun && !this.#closing);
    })().finally(() => {
      this.#running = null;
    });
  }

  #closeGate(): void {
    const previous = this.#load;
    this.#load = null;
    previous?.engine.abortAll();
  }

  #fail(
    state: 'failed' | 'insufficient_space',
    snapshotId: string | null,
    reason: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void {
    this.#state = state;
    this.#pending = { snapshotId, state };
    this.#retryAt = Date.now() + this.#config.retryMs;
    this.#log('load_failed', { reason, snapshotId, state, ...fields });
  }

  async #reload(): Promise<void> {
    const previous = { key: this.#attemptedKey, state: this.#state };
    // Close the gate before anything else, so no request can reach the old generation again.
    this.#closeGate();
    this.#state = 'loading';
    this.#pending = { snapshotId: null, state: 'loading' };
    if (this.#closing) return;

    const reading = await this.#read();
    this.#attemptedKey = reading.key;
    this.#retryAt = null;
    if (this.#resident?.engine.hasExited === true) await this.#retire();
    const resident = this.#resident;
    if (resident !== null && reading.kind === 'search' && reading.key === resident.key) {
      if (await this.#resume(resident, reading.key)) return;
    }
    if (reading.kind === 'empty') {
      // A slot without search makes the resident generation obsolete. Promotion passes through
      // an empty slot for a moment, so the resident is removed only when the slot is still
      // without search one retry interval later, never on the first sight of it.
      const confirmed = previous.state === 'idle' && previous.key === reading.key;
      if (confirmed) await this.#retire();
      this.#state = 'idle';
      this.#pending = null;
      if (this.#resident !== null) this.#retryAt = Date.now() + this.#config.retryMs;
      this.#log('slot_without_search');
      return;
    }
    if (reading.kind === 'invalid') {
      // The slot may yet show the resident generation again, so its engine and files are kept.
      this.#fail('failed', reading.snapshotId, 'manifest_invalid');
      return;
    }

    const { manifest, search } = reading;
    const snapshotId = manifest.snapshotId;
    this.#pending = { snapshotId, state: 'loading' };
    this.#log('load_started', { snapshotId });

    let candidate: string | undefined;
    let engine: EngineProcess | undefined;
    let events: LimitEvents = { oomKills: 0, pidRefusals: 0 };
    try {
      const copy = await copySealedTree({
        afterCopy: this.#options.afterCopy,
        cloneFile: this.#options.cloneFile,
        expected: search.engine,
        measureSpace: this.#options.measureSpace,
        name: randomUUID(),
        reserveBytes: this.#config.reserveBytes,
        source: join(
          this.#options.store.slotRoot(this.#config.slot),
          ...search.engine.root.split('/'),
        ),
        workRoot: this.#config.workRoot,
      });
      candidate = copy.path;
      this.#recordCopy(
        copy.method,
        copy.copyMilliseconds,
        copy.verifyMilliseconds,
        copy.listing.bytes,
      );
      await this.#ensureCurrent(reading.key);

      // The safe point: the replacement is verified on disk and is still the slot's generation.
      await this.#retire();
      events = await readLimitEvents(this.#cgroupRoot);
      const started = performance.now();
      const temporaryDirectory = join(this.#config.workRoot, 'tmp');
      engine = EngineProcess.start({
        command: this.#options.engineCommand({
          dataDirectory: copy.path,
          homeDirectory: join(this.#config.workRoot, 'home'),
          port: this.#config.enginePort,
          temporaryDirectory,
        }),
        home: join(this.#config.workRoot, 'home'),
        path: process.env['PATH'],
        port: this.#config.enginePort,
        temporaryDirectory,
      });
      await awaitEngine(
        engine,
        search.engine.importDate,
        this.#config.startupTimeoutMs,
        () => this.#closing,
      );
      this.#diagnostics = {
        ...this.#diagnostics,
        startupMilliseconds: Math.round(performance.now() - started),
      };
      const bounds = manifest.basemap!.bounds;
      await this.#verifyGeneration(engine, search, bounds);
      await this.#ensureCurrent(reading.key);

      const loaded: ResidentLoad = {
        bounds,
        engine,
        events,
        key: reading.key,
        search,
        snapshotId,
        tree: copy.path,
        treeBytes: copy.listing.bytes,
      };
      this.#resident = loaded;
      void engine.exited.then(() => this.#onEngineExit(loaded));
      this.#open(loaded, 'load_ready');
    } catch (error) {
      // Read before anything here stops it: only an engine that exited on its own is explained.
      const exitedOnItsOwn = engine?.hasExited === true;
      // A replacement that never became resident is discarded; the resident load is untouched.
      if (engine === undefined || this.#resident?.engine !== engine) {
        if (candidate !== undefined) {
          // A replacement engine only ever starts after the safe point, when no other one runs.
          if (engine !== undefined) await engine.stop();
          await removeWorkingCopy(candidate);
          if (engine !== undefined) await clearTemporary(this.#config.workRoot);
        }
      }
      if (
        error instanceof Superseded ||
        this.#closing ||
        (error instanceof LoadFailure && error.reason === 'cancelled')
      ) {
        this.#rerun = !this.#closing;
        return;
      }
      const retained = { retainedBytes: this.#resident?.treeBytes ?? 0 };
      if (error instanceof InsufficientSpaceError) {
        this.#fail('insufficient_space', snapshotId, 'insufficient_space', {
          availableBytes: error.plan.availableBytes,
          requiredBytes: error.plan.requiredBytes,
          ...retained,
        });
        return;
      }
      if (engine !== undefined && error instanceof LoadFailure && error.reason !== 'probe_failed') {
        for (const line of engine.recentOutput) this.#log('engine_output', { line });
      }
      // An engine that died while starting is explained the same way as one that died serving.
      const exited =
        engine !== undefined && exitedOnItsOwn
          ? await this.#explainExit(engine, events, snapshotId)
          : null;
      const reason =
        exited !== null && exited !== 'exited'
          ? exited
          : error instanceof LoadFailure
            ? error.reason
            : candidate === undefined &&
                error instanceof PlatformError &&
                error.code === 'VALIDATION_FAILED'
              ? 'working_copy_mismatch'
              : 'load_error';
      this.#fail('failed', snapshotId, reason, retained);
    }
  }

  /**
   * Reopens the resident load when the slot again holds its generation. The engine never stopped
   * and its working copy was verified when it was made; the running engine is proved again exactly
   * as a new one would be, and the gate reopens under a new identity. Returns false when the
   * resident load cannot be proved, after retiring it.
   */
  async #resume(resident: ResidentLoad, key: string): Promise<boolean> {
    this.#pending = { snapshotId: resident.snapshotId, state: 'loading' };
    try {
      await awaitEngine(
        resident.engine,
        resident.search.engine.importDate,
        this.#config.startupTimeoutMs,
        () => this.#closing,
      );
      await this.#verifyGeneration(resident.engine, resident.search, resident.bounds);
      await this.#ensureCurrent(key);
    } catch (error) {
      if (
        error instanceof Superseded ||
        this.#closing ||
        (error instanceof LoadFailure && error.reason === 'cancelled')
      ) {
        this.#rerun = !this.#closing;
        return true;
      }
      this.#log('resume_failed', {
        reason: error instanceof LoadFailure ? error.reason : 'load_error',
        snapshotId: resident.snapshotId,
      });
      await this.#retire();
      return false;
    }
    this.#open(resident, 'load_resumed');
    return true;
  }

  /** Opens the gate for a proved resident load under a fresh random identity. */
  #open(resident: ResidentLoad, event: 'load_ready' | 'load_resumed'): void {
    const identity: HostLoad = {
      engineImportDate: resident.search.engine.importDate,
      generationMarker: resident.search.generationMarker,
      loadId: randomUUID(),
      slot: this.#config.slot,
      snapshotId: resident.snapshotId,
    };
    this.#load = { bounds: resident.bounds, engine: resident.engine, identity };
    this.#state = 'ready';
    this.#pending = null;
    this.#log(event, {
      copyMethod: this.#diagnostics.copyMethod,
      loadId: identity.loadId,
      snapshotId: resident.snapshotId,
      startupMilliseconds: this.#diagnostics.startupMilliseconds,
    });
  }

  /** Stops the resident engine, then removes its files: nothing is deleted under a running engine. */
  async #retire(): Promise<void> {
    const resident = this.#resident;
    if (resident === null) return;
    this.#resident = null;
    if (this.#load?.engine === resident.engine) this.#closeGate();
    await resident.engine.stop();
    await removeWorkingCopy(resident.tree);
    await clearTemporary(this.#config.workRoot);
    this.#log('load_retired', { snapshotId: resident.snapshotId });
  }

  #recordCopy(method: CopyMethod, copyMs: number, verifyMs: number, bytes: number): void {
    this.#diagnostics = {
      ...this.#diagnostics,
      copyMethod: method,
      copyMilliseconds: Math.round(copyMs),
      treeBytes: bytes,
      verifyMilliseconds: Math.round(verifyMs),
    };
  }

  async #ensureCurrent(key: string): Promise<void> {
    if (this.#closing) throw new Superseded();
    const reading = await this.#read();
    if (reading.key !== key) throw new Superseded();
  }

  /** The canary proves the generation; the probes prove the data answers as it did when built. */
  async #verifyGeneration(
    engine: EngineProcess,
    search: SearchComponent,
    bounds: GeographicBounds,
  ): Promise<void> {
    const timeoutMs = this.#config.queryTimeoutMs * 5;
    await verifyCanary(engine, search.canary.coordinate, search.generationMarker, timeoutMs);
    await verifyProbes(engine, search.probes, bounds, timeoutMs);
  }

  #onEngineExit(resident: ResidentLoad): void {
    // A resident engine behind a closed gate is removed by the next transition.
    if (this.#closing || this.#load?.engine !== resident.engine) return;
    // Fail closed at once, then find out why, then load the slot again from its sealed copy.
    this.#closeGate();
    this.#state = 'failed';
    this.#pending = { snapshotId: resident.snapshotId, state: 'failed' };
    this.#retryAt = null;
    void this.#explainExit(resident.engine, resident.events, resident.snapshotId).then((reason) => {
      // A transition that started meanwhile owns the state, and retires the dead engine itself.
      if (this.#closing || this.#running !== null) return;
      this.#fail('failed', resident.snapshotId, reason, this.#limitFields());
      this.#retryAt = Date.now();
      this.#transition();
    });
  }

  /**
   * Names the limit an engine that exited on its own most likely reached, records it for the
   * status, and logs it with the limits in force: never a path, only numbers and a reason.
   */
  async #explainExit(
    engine: EngineProcess,
    before: LimitEvents,
    snapshotId: string,
  ): Promise<EngineExitReason> {
    const after = await readLimitEvents(this.#cgroupRoot);
    const reason = classifyEngineExit({ code: engine.exitCode }, before, after);
    this.#diagnostics = { ...this.#diagnostics, lastEngineExit: reason };
    this.#log('engine_exit', {
      exitCode: engine.exitCode,
      reason,
      snapshotId,
      ...this.#limitFields(),
    });
    return reason;
  }

  #limitFields(): Readonly<Record<string, unknown>> {
    return {
      heapLimit: this.#config.heap,
      memoryLimitBytes: this.#diagnostics.memoryLimitBytes,
      pidsLimit: this.#diagnostics.pidsLimit,
    };
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://host.invalid');
    if (request.method !== 'GET') {
      send(response, 405, '{"error":"method_not_allowed"}', { allow: 'GET' });
      return;
    }
    if (url.pathname === HOST_ROUTES.status) {
      if ([...url.searchParams].length > 0) {
        send(response, 400, '{"error":"invalid_request"}');
        return;
      }
      send(response, 200, JSON.stringify(await this.status()));
      return;
    }
    const route =
      url.pathname === HOST_ROUTES.search
        ? 'search'
        : url.pathname === HOST_ROUTES.reverse
          ? 'reverse'
          : undefined;
    if (route === undefined) {
      send(response, 404, '{"error":"not_found"}');
      return;
    }
    await this.#proxy(route, url, response);
  }

  async #proxy(route: 'search' | 'reverse', url: URL, response: ServerResponse): Promise<void> {
    const parameters = parseHostParameters(url, route);
    if (parameters === undefined) {
      send(response, 400, '{"error":"invalid_request"}');
      return;
    }
    const unavailable = async () => send(response, 503, JSON.stringify(await this.status()));

    // Before: capture the load this request is bound to. A closed gate answers nothing.
    const load = this.#load;
    if (this.#state !== 'ready' || load === null) return unavailable();

    const query = engineQuery(route, parameters);
    const result = await load.engine.get(query.path, query.parameters, this.#config.queryTimeoutMs);

    // After the engine answers: the same load must still be the one serving.
    if (this.#load !== load) return unavailable();
    if (result.kind === 'timeout' || result.kind === 'unreachable' || result.kind === 'aborted') {
      return unavailable();
    }
    const collection = parseCollection(result);
    if (collection === undefined || result.kind !== 'response') {
      send(response, 502, '{"error":"upstream_failed"}');
      return;
    }
    if (this.#config.fenceMs > 0) await delay(this.#config.fenceMs);

    // Immediately before responding: still the same load, still ready.
    if (this.#load !== load || this.#state !== 'ready') return unavailable();
    send(response, 200, result.response.body, {
      [HOST_HEADERS.generation]: load.identity.generationMarker,
      [HOST_HEADERS.loadId]: load.identity.loadId,
      [HOST_HEADERS.snapshotId]: load.identity.snapshotId,
    });
  }
}
