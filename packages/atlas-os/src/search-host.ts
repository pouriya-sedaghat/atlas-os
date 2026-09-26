import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { PlatformError } from './errors.js';
import { DEFAULT_ENGINE_ARCHIVE, readSearchHostConfig } from './internal/search/host/config.js';
import { engineServeCommand } from './internal/search/host/engine.js';
import { SearchEngineHost } from './internal/search/host/host.js';
import { LoadFailure } from './internal/search/host/verify.js';
import { probeSelectionRequestSchema, selectProbesWithEngine } from './internal/search/probes.js';
import { SnapshotStore } from './internal/snapshot/store.js';

export interface SearchHostOptions {
  /** The data root holding the slots. The host only ever reads it. */
  readonly dataRoot: string;
  readonly region: string;
  /**
   * Environment the host reads its own configuration from: which slot it serves, where its
   * private working state lives, and how the engine runs. Callers pass it through uninterpreted.
   */
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  /** Structured, path-free lifecycle events. */
  readonly log?: ((event: Readonly<Record<string, unknown>>) => void) | undefined;
}

/** A running per-slot search host, as seen by the process that owns it. */
export interface SearchHostHandle {
  /** Starts answering status at once and loads the slot in the background. */
  start(): Promise<{ readonly address: string; readonly port: number }>;
  close(): Promise<void>;
}

/**
 * Composes the private search host for one slot.
 *
 * The host is the only process that talks to the search engine. It serves a small private
 * protocol on the internal network, and the engine behind it listens on loopback only.
 */
export function createSearchHost(options: SearchHostOptions): SearchHostHandle {
  const config = readSearchHostConfig(options.environment ?? process.env);
  const host = new SearchEngineHost({
    config,
    engineCommand: engineServeCommand(config),
    log: options.log,
    region: options.region,
    store: new SnapshotStore(options.dataRoot),
  });
  return {
    close: () => host.close(),
    start: async () => {
      const address = await host.start();
      return { address: address.address, port: address.port };
    },
  };
}

function requiredPath(
  environment: Readonly<Record<string, string | undefined>>,
  variable: string,
): string {
  const value = environment[variable];
  if (value === undefined || !isAbsolute(value) || value.includes('\0')) {
    throw new PlatformError('VALIDATION_FAILED', 'Probe selection configuration is invalid.', {
      details: { variable },
    });
  }
  return value;
}

/**
 * Build-time probe selection, run inside the serving image with no network during an explicit
 * preparation: starts a freshly sealed search database on a disposable copy, proves its
 * generation, and records which candidate questions it answers. Never part of serving.
 */
export async function runSearchProbeSelection(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const sealed = requiredPath(environment, 'ATLAS_SEARCH_PROBE_DATA');
  const requestPath = requiredPath(environment, 'ATLAS_SEARCH_PROBE_REQUEST');
  const resultPath = requiredPath(environment, 'ATLAS_SEARCH_PROBE_RESULT');
  const workRoot = requiredPath(environment, 'ATLAS_SEARCH_WORK_ROOT');
  const heap = environment['ATLAS_SEARCH_ENGINE_HEAP'] || '1g';
  if (!/^[1-9][0-9]{0,5}[mg]$/.test(heap)) {
    throw new PlatformError('VALIDATION_FAILED', 'Probe selection configuration is invalid.', {
      details: { variable: 'ATLAS_SEARCH_ENGINE_HEAP' },
    });
  }
  const parsed = probeSelectionRequestSchema.safeParse(
    JSON.parse(await readFile(requestPath, 'utf8')),
  );
  if (!parsed.success) {
    throw new PlatformError('VALIDATION_FAILED', 'Probe selection request is invalid.');
  }
  try {
    const probes = await selectProbesWithEngine({
      engineCommand: engineServeCommand({
        engineArchive: environment['ATLAS_SEARCH_ENGINE_ARCHIVE'] || DEFAULT_ENGINE_ARCHIVE,
        heap,
        javaExecutable: environment['ATLAS_SEARCH_ENGINE_JAVA'] || 'java',
      }),
      request: parsed.data,
      sealedEngine: sealed,
      workRoot,
    });
    await writeFile(resultPath, `${JSON.stringify(probes)}\n`);
  } catch (error) {
    if (error instanceof LoadFailure) {
      throw new PlatformError('VALIDATION_FAILED', 'The sealed search database did not verify.', {
        details: { reason: error.reason },
      });
    }
    throw error;
  }
}
