import { setTimeout as delay } from 'node:timers/promises';

import type { DockerRunner } from './cleanup.js';
import { runDocker } from './cleanup.js';

export const SEARCH_HOST_IMAGE = 'atlas-os/search:m2';

/** The serving image's user: `USER 10001:10001` in `infra/images/search.Dockerfile`. */
export const SEARCH_HOST_USER = { gid: 10001, uid: 10001 } as const;

/** Where the host keeps its working copies: the image's `ATLAS_SEARCH_WORK_ROOT`. */
export const SEARCH_HOST_WORK_ROOT = '/var/lib/atlas-engine';

/**
 * The production host in its own image, as the engine test runs it: read-only root, no
 * capabilities, bounded memory and processes, the dataset read-only, and no engine port.
 *
 * Compose gives each host a named volume, which Docker fills from the image, so it inherits the
 * image's `10001:10001` owner and `0700` mode. A tmpfs does not take the image directory's
 * owner, so the owner and mode are set explicitly: private to the serving user, never
 * world-writable. The daemon still mounts it `noexec`, `nosuid` and `nodev`.
 */
export function searchHostRunArguments(options: {
  readonly name: string;
  readonly dataRoot: string;
  readonly port: number;
}): string[] {
  const { gid, uid } = SEARCH_HOST_USER;
  return [
    'run',
    '--detach',
    '--name',
    options.name,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--tmpfs=/tmp:rw,size=64m',
    '--memory=1g',
    '--memory-swap=1g',
    '--pids-limit=1024',
    '--volume',
    `${options.dataRoot}:/var/lib/atlas:ro`,
    `--tmpfs=${SEARCH_HOST_WORK_ROOT}:rw,size=536870912,uid=${uid},gid=${gid},mode=0700`,
    '--env',
    'ATLAS_SEARCH_SLOT=blue',
    '--env',
    'ATLAS_DATA_ROOT=/var/lib/atlas',
    '--env',
    'ATLAS_SEARCH_ENGINE_HEAP=512m',
    '--publish',
    `127.0.0.1:${options.port}:2322`,
    SEARCH_HOST_IMAGE,
  ];
}

/** What Docker reports about a container's process; see `docker inspect` `.State`. */
export interface ContainerState {
  readonly Status: string;
  readonly Running: boolean;
  readonly ExitCode: number;
  readonly OOMKilled: boolean;
  readonly Error: string;
}

/** The most output kept from each stream in a failure message. */
export const LOG_LIMIT_BYTES = 4096;

function lastBytes(text: string, limit: number): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= limit) return text.trimEnd();
  return `[… ${bytes.length - limit} earlier bytes omitted]\n${bytes
    .subarray(bytes.length - limit)
    .toString('utf8')
    .trimEnd()}`;
}

/** The container's state, or why Docker could not report it. */
export function inspectContainer(
  name: string,
  run: DockerRunner = runDocker,
): { readonly state: ContainerState } | { readonly error: string } {
  const inspected = run(['inspect', '--format', '{{json .State}}', name]);
  if (inspected.error !== undefined || inspected.status !== 0) {
    return { error: inspected.error?.message ?? `${inspected.stderr ?? ''}`.trim() };
  }
  try {
    return { state: JSON.parse(inspected.stdout) as ContainerState };
  } catch {
    return { error: `unreadable state: ${lastBytes(inspected.stdout, 256)}` };
  }
}

/** The container's recent standard output and error, each bounded, for a failure message. */
export function containerLogs(name: string, run: DockerRunner = runDocker): string {
  const logs = run(['logs', '--tail', '200', name]);
  if (logs.error !== undefined || logs.status !== 0) {
    return `(logs unavailable: ${logs.error?.message ?? `${logs.stderr ?? ''}`.trim()})`;
  }
  return [
    `--- stderr (last ${LOG_LIMIT_BYTES} bytes at most) ---`,
    lastBytes(logs.stderr ?? '', LOG_LIMIT_BYTES) || '(empty)',
    `--- stdout (last ${LOG_LIMIT_BYTES} bytes at most) ---`,
    lastBytes(logs.stdout ?? '', LOG_LIMIT_BYTES) || '(empty)',
  ].join('\n');
}

function describeState(state: ContainerState): string {
  return [
    `status=${state.Status}`,
    `exitCode=${state.ExitCode}`,
    `OOMKilled=${state.OOMKilled}`,
    `error=${JSON.stringify(state.Error ?? '')}`,
  ].join(' ');
}

/**
 * Waits for the host in a container to report ready, and fails at once, with its exit state and
 * recent output, if the container stops first. A container that stays up gets the whole
 * `timeoutMs`. Nothing here removes the container: its evidence is captured before any cleanup.
 */
export async function waitForContainerHost(options: {
  readonly name: string;
  readonly ready: () => Promise<boolean>;
  readonly timeoutMs: number;
  readonly intervalMs?: number;
  readonly run?: DockerRunner;
}): Promise<void> {
  const run = options.run ?? runDocker;
  const interval = options.intervalMs ?? 500;
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    if (await options.ready().catch(() => false)) return;
    const inspected = inspectContainer(options.name, run);
    if ('error' in inspected) {
      throw new Error(
        `Search host container ${options.name} could not be inspected before it was ready: ${inspected.error}`,
      );
    }
    if (!inspected.state.Running) {
      throw new Error(
        `Search host container ${options.name} stopped before it was ready: ${describeState(inspected.state)}\n${containerLogs(options.name, run)}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Search host container ${options.name} was not ready within ${options.timeoutMs} ms and is still running: ${describeState(inspected.state)}\n${containerLogs(options.name, run)}`,
      );
    }
    await delay(Math.min(interval, Math.max(0, deadline - Date.now())));
  }
}
