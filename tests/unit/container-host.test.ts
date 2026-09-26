import type { SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { DockerRunner } from '../helpers/cleanup.js';
import {
  LOG_LIMIT_BYTES,
  SEARCH_HOST_USER,
  SEARCH_HOST_WORK_ROOT,
  searchHostRunArguments,
  waitForContainerHost,
} from '../helpers/container-host.js';

const NAME = 'atlas-os-engine-test-1';

function result(stdout: string, status = 0, stderr = ''): SpawnSyncReturns<string> {
  return { output: [], pid: 1, signal: null, status, stderr, stdout };
}

const RUNNING = JSON.stringify({
  Error: '',
  ExitCode: 0,
  OOMKilled: false,
  Running: true,
  Status: 'running',
});
const EXITED = JSON.stringify({
  Error: '',
  ExitCode: 1,
  OOMKilled: false,
  Running: false,
  Status: 'exited',
});
const EACCES = "Error: EACCES: permission denied, lstat '/var/lib/atlas-engine/trees'";

/** A Docker client stand-in: `inspect` walks through `states`, `logs` returns fixed output. */
function docker(
  states: readonly string[],
  logs: { readonly stdout?: string; readonly stderr?: string } = {},
): { run: DockerRunner; calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;
  const run: DockerRunner = (args) => {
    calls.push([...args]);
    if (args[0] === 'inspect') return result(states[Math.min(index++, states.length - 1)]!);
    if (args[0] === 'logs') return result(logs.stdout ?? '', 0, logs.stderr ?? '');
    return result('', 1, `unexpected docker ${args[0]}`);
  };
  return { calls, run };
}

function tmpfsOptions(args: readonly string[], target: string): Map<string, string> {
  const flag = args.find((arg) => arg.startsWith(`--tmpfs=${target}:`));
  expect(flag, target).toBeDefined();
  return new Map(
    flag!
      .slice(`--tmpfs=${target}:`.length)
      .split(',')
      .map((option) => {
        const [key, value = ''] = option.split('=');
        return [key!, value] as const;
      }),
  );
}

describe('search host container launch', () => {
  const args = searchHostRunArguments({ dataRoot: '/srv/atlas-data', name: NAME, port: 41234 });

  it('mounts a private work root that the serving user owns and can traverse', () => {
    const options = tmpfsOptions(args, SEARCH_HOST_WORK_ROOT);
    expect(options.get('uid')).toBe(String(SEARCH_HOST_USER.uid));
    expect(options.get('gid')).toBe(String(SEARCH_HOST_USER.gid));
    expect(options.get('mode')).toBe('0700');
    // Owner-only: nothing for group or others, and never world-writable.
    expect(Number.parseInt(options.get('mode')!, 8) & 0o077).toBe(0);
    expect(options.get('size')).toBe('536870912');
    expect(options.has('exec')).toBe(false);
    // Only options the daemon's tmpfs parser accepts and the tmpfs guide documents.
    expect([...options.keys()].sort()).toEqual(['gid', 'mode', 'rw', 'size', 'uid']);
    // No second, ownerless mount of the same directory.
    expect(args.filter((arg) => arg.includes(SEARCH_HOST_WORK_ROOT))).toHaveLength(1);
    expect(args).not.toContain('--mount');
  });

  it('keeps the host hardened, bounded and reachable only on loopback', () => {
    for (const flag of [
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true',
      '--memory=1g',
      '--memory-swap=1g',
      '--pids-limit=1024',
    ]) {
      expect(args, flag).toContain(flag);
    }
    expect(args.join(' ')).toContain('--volume /srv/atlas-data:/var/lib/atlas:ro');
    expect(args.filter((arg) => arg === '--publish')).toHaveLength(1);
    expect(args[args.indexOf('--publish') + 1]).toBe('127.0.0.1:41234:2322');
    for (const forbidden of ['--privileged', '--user', '--cap-add', '--network=host', '-p']) {
      expect(args, forbidden).not.toContain(forbidden);
    }
    expect(args.at(-1)).toBe('atlas-os/search:m2');
  });

  it("uses the serving image's own user and work directory", () => {
    const dockerfile = readFileSync(
      new URL('../../infra/images/search.Dockerfile', import.meta.url),
      'utf8',
    );
    const runtime = dockerfile.slice(dockerfile.indexOf('AS search-runtime'));
    const { gid, uid } = SEARCH_HOST_USER;
    expect(runtime).toContain(`USER ${uid}:${gid}`);
    expect(runtime).toContain(`ATLAS_SEARCH_WORK_ROOT=${SEARCH_HOST_WORK_ROOT}`);
    expect(runtime).toContain(`chown ${uid}:${gid} ${SEARCH_HOST_WORK_ROOT}`);
    expect(runtime).toContain(`chmod 0700 ${SEARCH_HOST_WORK_ROOT}`);
  });
});

describe('waiting for a search host container', () => {
  it('fails at once when the container exits, with its state and output', async () => {
    const { calls, run } = docker([RUNNING, EXITED], {
      stderr: `starting\n${EACCES}\n`,
      stdout: '{"event":"limits"}\n',
    });
    const started = Date.now();
    const failure = await waitForContainerHost({
      intervalMs: 5,
      name: NAME,
      // An unreachable host is simply not ready yet.
      ready: () => Promise.reject(new Error('connect ECONNREFUSED')),
      run,
      timeoutMs: 300_000,
    }).catch((error: unknown) => error as Error);

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain(`${NAME} stopped before it was ready`);
    expect(failure.message).toContain('status=exited exitCode=1 OOMKilled=false');
    expect(failure.message).toContain(EACCES);
    expect(failure.message).toContain('{"event":"limits"}');
    // The evidence is read before anything removes the container; the wait removes nothing.
    expect(calls.map((call) => call[0])).toEqual(['inspect', 'inspect', 'logs']);
  });

  it('bounds the output it reports', async () => {
    const { run } = docker([EXITED], { stderr: `${'x'.repeat(100_000)}\nlast line\n` });
    const failure = await waitForContainerHost({
      name: NAME,
      ready: async () => false,
      run,
      timeoutMs: 300_000,
    }).catch((error: unknown) => error as Error);
    expect(failure.message).toContain('last line');
    expect(failure.message).toMatch(/\[… \d+ earlier bytes omitted\]/);
    expect(failure.message.length).toBeLessThan(2 * LOG_LIMIT_BYTES + 1_000);
  });

  it('gives a container that stays up the whole timeout', async () => {
    const { run } = docker([RUNNING], { stderr: 'still loading\n' });
    const started = Date.now();
    const failure = await waitForContainerHost({
      intervalMs: 10,
      name: NAME,
      ready: async () => false,
      run,
      timeoutMs: 150,
    }).catch((error: unknown) => error as Error);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect(failure.message).toContain('was not ready within 150 ms and is still running');
    expect(failure.message).toContain('still loading');
    expect(failure.message).not.toContain('stopped before');
  });

  it('returns as soon as the host is ready', async () => {
    const { calls, run } = docker([RUNNING]);
    let asked = 0;
    await waitForContainerHost({
      intervalMs: 1,
      name: NAME,
      ready: async () => ++asked === 3,
      run,
      timeoutMs: 10_000,
    });
    expect(asked).toBe(3);
    expect(calls.every((call) => call[0] === 'inspect')).toBe(true);
  });

  it('fails when the container cannot be inspected', async () => {
    const run: DockerRunner = () => result('', 1, `Error: No such object: ${NAME}`);
    await expect(
      waitForContainerHost({ name: NAME, ready: async () => false, run, timeoutMs: 10_000 }),
    ).rejects.toThrow(`could not be inspected before it was ready: Error: No such object: ${NAME}`);
  });
});
