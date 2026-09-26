import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyEngineExit,
  readContainerLimits,
  readLimitEvents,
} from '../../packages/atlas-os/src/internal/search/host/limits.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function cgroup(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-os-cgroup-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

describe('container limits', () => {
  it('reads the unified hierarchy', async () => {
    const root = await cgroup({
      'memory.events': 'low 0\nhigh 0\nmax 12\noom 2\noom_kill 2\n',
      'memory.max': '2147483648\n',
      'pids.events': 'max 3\n',
      'pids.max': '1024\n',
    });
    expect(await readContainerLimits(root)).toEqual({ memoryBytes: 2_147_483_648, pids: 1024 });
    expect(await readLimitEvents(root)).toEqual({ oomKills: 2, pidRefusals: 3 });
  });

  it('reads the per-controller layout', async () => {
    const root = await cgroup({
      'memory/memory.limit_in_bytes': '1073741824\n',
      'memory/memory.oom_control': 'oom_kill_disable 0\nunder_oom 0\noom_kill 1\n',
      'pids/pids.events': 'max 0\n',
      'pids/pids.max': '512\n',
    });
    expect(await readContainerLimits(root)).toEqual({ memoryBytes: 1_073_741_824, pids: 512 });
    expect(await readLimitEvents(root)).toEqual({ oomKills: 1, pidRefusals: 0 });
  });

  it('reports no limit rather than guessing one', async () => {
    const unlimited = await cgroup({
      'memory.max': 'max\n',
      'pids.max': 'max\n',
    });
    expect(await readContainerLimits(unlimited)).toEqual({ memoryBytes: null, pids: null });
    // The per-controller layout reports "unlimited" as a huge page-aligned number.
    const huge = await cgroup({ 'memory/memory.limit_in_bytes': '9223372036854771712\n' });
    expect((await readContainerLimits(huge)).memoryBytes).toBeNull();
    const absent = await cgroup({});
    expect(await readContainerLimits(absent)).toEqual({ memoryBytes: null, pids: null });
    expect(await readLimitEvents(absent)).toEqual({ oomKills: 0, pidRefusals: 0 });
  });

  it('names the limit an engine reached from the kernel counters and its exit status', () => {
    const quiet = { oomKills: 0, pidRefusals: 0 };
    expect(classifyEngineExit({ code: null }, quiet, { oomKills: 1, pidRefusals: 0 })).toBe(
      'memory_limit',
    );
    // The runtime exits with 3 when it cannot create a thread, as with an exhausted heap.
    expect(classifyEngineExit({ code: 3 }, quiet, { oomKills: 0, pidRefusals: 4 })).toBe(
      'pids_limit',
    );
    expect(classifyEngineExit({ code: 3 }, quiet, quiet)).toBe('heap_exhausted');
    expect(classifyEngineExit({ code: 1 }, quiet, quiet)).toBe('exited');
    expect(classifyEngineExit({ code: null }, quiet, quiet)).toBe('exited');
    // Only counts that grew while this engine ran are attributed to it.
    const earlier = { oomKills: 5, pidRefusals: 5 };
    expect(classifyEngineExit({ code: 1 }, earlier, earlier)).toBe('exited');
  });
});
