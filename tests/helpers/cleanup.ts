import type { SpawnSyncReturns } from 'node:child_process';
import { spawnSync } from 'node:child_process';

export type DockerRunner = (args: readonly string[]) => SpawnSyncReturns<string>;

export const runDocker: DockerRunner = (args) =>
  spawnSync('docker', [...args], { encoding: 'utf8', stdio: 'pipe' });

/**
 * Removes a container by name and fails when it cannot, so a test never leaves one behind
 * silently. `missingOk` accepts a container that was never created, as after a failed start.
 */
export function removeContainer(
  name: string,
  options: { readonly missingOk?: boolean; readonly run?: DockerRunner } = {},
): void {
  const removed = (options.run ?? runDocker)(['rm', '--force', name]);
  if (removed.error === undefined && removed.status === 0) return;
  const reason = removed.error?.message ?? `${removed.stderr ?? ''}`.trim();
  if (options.missingOk === true && /no such container/i.test(reason)) return;
  throw new Error(
    `Container ${name} could not be removed: ${reason || `status ${removed.status}`}`,
  );
}

/**
 * Runs every cleanup step even when an earlier one fails, then fails with every failure: the
 * first alone when there is one, otherwise all of them together. Nothing is masked.
 */
export async function cleanUp(steps: readonly (() => unknown)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Several cleanup steps failed.');
}
