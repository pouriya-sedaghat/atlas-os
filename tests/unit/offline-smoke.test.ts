import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeArguments, runOfflineSmoke } from '../../scripts/offline-smoke.mjs';

/**
 * A stand-in for the Docker client: a real child process that records every command it is given
 * and fails the subcommands a test names, exactly as the client reports a failure, with a status
 * and a message on standard error.
 */
const FAKE_DOCKER = String.raw`
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\n');
const failing = (process.env.FAKE_DOCKER_FAIL || '').split(',').filter(Boolean);
const subcommand = args[0] === 'compose' ? args[5] : args[0];
if (failing.includes(subcommand)) {
  process.stderr.write('Error response from daemon: ' + subcommand + ' failed\n');
  process.exit(3);
}
`;

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function scenario(options: {
  readonly fail?: readonly string[];
  readonly verify?: () => Promise<void>;
}) {
  const scratch = await mkdtemp(join(tmpdir(), 'atlas-os-fake-docker-'));
  directories.push(scratch);
  const script = join(scratch, 'docker.cjs');
  const log = join(scratch, 'calls.jsonl');
  await writeFile(script, FAKE_DOCKER);
  await writeFile(log, '');
  const dataRoot = await mkdtemp(join(scratch, 'data-'));
  const environment = {
    ...process.env,
    FAKE_DOCKER_FAIL: (options.fail ?? []).join(','),
    FAKE_DOCKER_LOG: log,
  };
  const run = (args: readonly string[], env: NodeJS.ProcessEnv) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env, stdio: 'pipe' });

  const errors: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    errors.push(String(chunk));
    return true;
  });
  const output: string[] = [];
  const outcome = runOfflineSmoke({
    dataRoot,
    environment,
    inspect: () => undefined,
    provision: () => 'snapshot-1',
    run,
    verify: options.verify ?? (async () => undefined),
    write: (text: string) => output.push(text),
  });
  const calls = async () =>
    (await readFile(log, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  const removed = async () =>
    stat(dataRoot).then(
      () => false,
      () => true,
    );
  return { calls, errors, outcome, output, removed };
}

const DOWN = [...composeArguments, 'down', '--volumes', '--remove-orphans'];

describe('offline smoke test cleanup', () => {
  it('fails when every check passed but cleanup did not', async () => {
    const run = await scenario({ fail: ['down'] });
    await expect(run.outcome).resolves.toBe(1);
    expect(await run.calls()).toContainEqual(DOWN);
    expect(run.errors.join('')).toContain('docker compose down --volumes --remove-orphans failed');
    expect(run.errors.join('')).toContain('down failed');
    expect(run.errors.join('')).toContain('The offline smoke test did not pass.');
    expect(run.output.join('')).not.toContain('Offline smoke test passed');
    expect(await run.removed()).toBe(true);
  });

  it('passes only when the checks pass and cleanup completes', async () => {
    const run = await scenario({});
    await expect(run.outcome).resolves.toBe(0);
    expect((await run.calls()).at(-1)).toEqual(DOWN);
    expect(run.output.join('')).toContain('Offline smoke test passed');
    expect(await run.removed()).toBe(true);
  });

  it('keeps a failed check as the primary result when cleanup fails too', async () => {
    const run = await scenario({
      fail: ['down'],
      verify: async () => {
        throw new Error('search answered from the wrong generation');
      },
    });
    await expect(run.outcome).rejects.toThrow('search answered from the wrong generation');
    expect(await run.calls()).toContainEqual(DOWN);
    expect(run.errors.join('')).toContain('Cleanup failed as well');
    // The failed check collected the runtime's diagnostics before tearing down.
    expect(await run.calls()).toContainEqual([...composeArguments, 'ps', '--all']);
  });

  it('keeps a failed startup as the primary result when cleanup fails too', async () => {
    const run = await scenario({ fail: ['up', 'down'] });
    await expect(run.outcome).resolves.toBe(3);
    expect(await run.calls()).toContainEqual(DOWN);
    expect(run.errors.join('')).toContain('Cleanup failed as well');
  });
});
