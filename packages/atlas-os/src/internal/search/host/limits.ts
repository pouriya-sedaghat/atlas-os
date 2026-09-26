import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The hard limits the container runtime placed on this host, where the kernel reports them. */
export interface ContainerLimits {
  readonly memoryBytes: number | null;
  readonly pids: number | null;
}

/** How often each limit has been enforced so far: kills for memory, refused forks for PIDs. */
export interface LimitEvents {
  readonly oomKills: number;
  readonly pidRefusals: number;
}

/** Why a running engine stopped without being asked to. */
export type EngineExitReason = 'memory_limit' | 'pids_limit' | 'heap_exhausted' | 'exited';

export const CGROUP_ROOT = '/sys/fs/cgroup';

/** The engine runtime's exit status after `-XX:+ExitOnOutOfMemoryError`. */
const OUT_OF_MEMORY_EXIT = 3;

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** A limit file's value; `max`, or a value too large to be a real limit, means unlimited. */
function limitValue(text: string | null): number | null {
  const value = text?.trim();
  if (value === undefined || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed < 2 ** 60 ? parsed : null;
}

function eventCount(text: string | null, key: string): number {
  const match = text === null ? null : new RegExp(`^${key} ([0-9]+)$`, 'm').exec(text);
  return match === null ? 0 : Number(match[1]);
}

/** Reads the unified hierarchy first and the older per-controller layout second. */
async function firstText(root: string, paths: readonly string[]): Promise<string | null> {
  for (const path of paths) {
    const text = await readText(join(root, path));
    if (text !== null) return text;
  }
  return null;
}

export async function readContainerLimits(root = CGROUP_ROOT): Promise<ContainerLimits> {
  return {
    memoryBytes: limitValue(await firstText(root, ['memory.max', 'memory/memory.limit_in_bytes'])),
    pids: limitValue(await firstText(root, ['pids.max', 'pids/pids.max'])),
  };
}

export async function readLimitEvents(root = CGROUP_ROOT): Promise<LimitEvents> {
  return {
    oomKills: eventCount(
      await firstText(root, ['memory.events', 'memory/memory.oom_control']),
      'oom_kill',
    ),
    pidRefusals: eventCount(await firstText(root, ['pids.events', 'pids/pids.events']), 'max'),
  };
}

/**
 * Names the limit an engine most likely reached, from the kernel's own counters: a kill by the
 * memory controller, a refused process or thread, or the runtime's own heap exhaustion.
 */
export function classifyEngineExit(
  exit: { readonly code: number | null },
  before: LimitEvents,
  after: LimitEvents,
): EngineExitReason {
  if (after.oomKills > before.oomKills) return 'memory_limit';
  if (after.pidRefusals > before.pidRefusals) return 'pids_limit';
  if (exit.code === OUT_OF_MEMORY_EXIT) return 'heap_exhausted';
  return 'exited';
}
