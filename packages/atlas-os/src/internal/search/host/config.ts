import { isAbsolute } from 'node:path';

import { PlatformError } from '../../../errors.js';
import type { SlotName } from '../../../snapshot.js';

/**
 * Configuration of one per-slot search engine host, read from its environment.
 *
 * Every value has a production default that matches the engine host image, so a Compose service
 * only names its slot. Nothing here is ever reported back through a public contract.
 */
export interface SearchHostConfig {
  readonly slot: SlotName;
  /** Writable, host-private state: the disposable working copy and the engine's home. */
  readonly workRoot: string;
  readonly listenAddress: string;
  readonly listenPort: number;
  /** The engine archive and the runtime that runs it. */
  readonly engineArchive: string;
  readonly javaExecutable: string;
  /** Maximum engine heap, in the runtime's own notation, for example `1g` or `768m`. */
  readonly heap: string;
  /** Loopback port the engine listens on; never reachable from outside the host. */
  readonly enginePort: number;
  /** Free space kept in reserve beyond the working copy itself. */
  readonly reserveBytes: number;
  /**
   * Extra wait between an engine answer and the final identity check. Zero by default: the
   * guard does not rely on elapsed time, and the tests prove it with no fence at all.
   */
  readonly fenceMs: number;
  readonly startupTimeoutMs: number;
  /** How often the slot is re-read to notice a promoted snapshot. */
  readonly pollMs: number;
  /** How long a failed load waits before it is attempted again. */
  readonly retryMs: number;
  readonly queryTimeoutMs: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

function invalid(variable: string): never {
  throw new PlatformError('VALIDATION_FAILED', 'Search engine host configuration is invalid.', {
    details: { variable },
  });
}

function text(environment: Environment, variable: string, fallback: string): string {
  const value = environment[variable];
  if (value === undefined || value === '') return fallback;
  return value;
}

function integer(
  environment: Environment,
  variable: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = environment[variable];
  if (value === undefined || value === '') return fallback;
  if (!/^[0-9]{1,16}$/.test(value)) invalid(variable);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) invalid(variable);
  return parsed;
}

function absolutePath(environment: Environment, variable: string, fallback: string): string {
  const value = text(environment, variable, fallback);
  if (!isAbsolute(value) || value.includes('\0')) invalid(variable);
  return value;
}

export const DEFAULT_WORK_ROOT = '/var/lib/atlas-engine';
export const DEFAULT_ENGINE_ARCHIVE = '/opt/atlas-os/engine/engine.jar';
export const DEFAULT_HOST_PORT = 2322;
export const DEFAULT_ENGINE_PORT = 2321;

export function readSearchHostConfig(environment: Environment): SearchHostConfig {
  const slot = environment['ATLAS_SEARCH_SLOT'];
  if (slot !== 'blue' && slot !== 'green') invalid('ATLAS_SEARCH_SLOT');

  const heap = text(environment, 'ATLAS_SEARCH_ENGINE_HEAP', '1g');
  if (!/^[1-9][0-9]{0,5}[mg]$/.test(heap)) invalid('ATLAS_SEARCH_ENGINE_HEAP');

  const listenAddress = text(environment, 'ATLAS_SEARCH_HOST_ADDRESS', '0.0.0.0');
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(listenAddress)) invalid('ATLAS_SEARCH_HOST_ADDRESS');

  const config: SearchHostConfig = {
    engineArchive: absolutePath(environment, 'ATLAS_SEARCH_ENGINE_ARCHIVE', DEFAULT_ENGINE_ARCHIVE),
    enginePort: integer(environment, 'ATLAS_SEARCH_ENGINE_PORT', DEFAULT_ENGINE_PORT, 1, 65_535),
    fenceMs: integer(environment, 'ATLAS_SEARCH_HOST_FENCE_MS', 0, 0, 10_000),
    heap,
    javaExecutable: text(environment, 'ATLAS_SEARCH_ENGINE_JAVA', 'java'),
    listenAddress,
    listenPort: integer(environment, 'ATLAS_SEARCH_HOST_PORT', DEFAULT_HOST_PORT, 1, 65_535),
    pollMs: integer(environment, 'ATLAS_SEARCH_HOST_POLL_MS', 1_000, 50, 60_000),
    queryTimeoutMs: 1_900,
    reserveBytes: integer(
      environment,
      'ATLAS_SEARCH_HOST_RESERVE_BYTES',
      256 * 1024 * 1024,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    retryMs: integer(environment, 'ATLAS_SEARCH_HOST_RETRY_MS', 30_000, 100, 3_600_000),
    slot,
    startupTimeoutMs: integer(
      environment,
      'ATLAS_SEARCH_ENGINE_STARTUP_TIMEOUT_MS',
      300_000,
      1_000,
      3_600_000,
    ),
    workRoot: absolutePath(environment, 'ATLAS_SEARCH_WORK_ROOT', DEFAULT_WORK_ROOT),
  };
  if (config.enginePort === config.listenPort) invalid('ATLAS_SEARCH_ENGINE_PORT');
  if (/[\s\0]/.test(config.javaExecutable)) invalid('ATLAS_SEARCH_ENGINE_JAVA');
  return config;
}
