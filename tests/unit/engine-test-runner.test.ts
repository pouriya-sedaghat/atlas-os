import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ENGINE_SUITE,
  PIPELINE_SUITE,
  planEngineRun,
  reportProblems,
} from '../../scripts/test-engine.mjs';

const WITH_DOCKER = { docker: () => true, java: () => true };
const NO_DOCKER = { docker: () => false, java: () => true };
const ARCHIVE = '/opt/tools/engine.jar';

function suite(file: string, statuses: readonly string[]) {
  return {
    assertionResults: statuses.map((status) => ({ status })),
    name: resolve('/checkout', file),
    status: 'passed',
  };
}

describe('the end-to-end engine gate', () => {
  it('requires the tiny-extract pipeline in container mode', () => {
    const plan = planEngineRun({ environment: {}, probe: WITH_DOCKER, scope: 'full' });
    expect(plan).toMatchObject({
      files: [PIPELINE_SUITE],
      mode: 'container',
      partial: false,
      required: [PIPELINE_SUITE],
    });
  });

  it('never runs a local engine without the pipeline and calls that unexecuted', () => {
    const plan = planEngineRun({
      environment: { ATLAS_SEARCH_ENGINE_ARCHIVE: ARCHIVE },
      probe: NO_DOCKER,
      scope: 'full',
    });
    expect(plan.unexecuted).toMatch(/ATLAS_SEARCH_BUILD_SCRIPT/);
    expect(plan.unexecuted).toMatch(/test:engine:jar/);
    expect(plan).not.toHaveProperty('files');
  });

  it('requires both suites in local mode with a database build', () => {
    const plan = planEngineRun({
      environment: {
        ATLAS_SEARCH_BUILD_SCRIPT: '/opt/build.sh',
        ATLAS_SEARCH_ENGINE_ARCHIVE: ARCHIVE,
      },
      probe: NO_DOCKER,
      scope: 'full',
    });
    expect(plan).toMatchObject({
      mode: 'local',
      partial: false,
      required: [ENGINE_SUITE, PIPELINE_SUITE],
    });
  });

  it('is unexecuted without Docker, without a runtime, or in an unknown mode', () => {
    expect(
      planEngineRun({
        environment: { ATLAS_ENGINE_TEST_MODE: 'container' },
        probe: NO_DOCKER,
        scope: 'full',
      }).unexecuted,
    ).toMatch(/reachable Docker daemon/);
    expect(planEngineRun({ environment: {}, probe: NO_DOCKER, scope: 'full' }).unexecuted).toMatch(
      /no Docker daemon/,
    );
    expect(
      planEngineRun({
        environment: {
          ATLAS_SEARCH_BUILD_SCRIPT: '/opt/build.sh',
          ATLAS_SEARCH_ENGINE_ARCHIVE: ARCHIVE,
        },
        probe: { docker: () => false, java: () => false },
        scope: 'full',
      }).unexecuted,
    ).toMatch(/Java runtime/);
    expect(
      planEngineRun({
        environment: { ATLAS_ENGINE_TEST_MODE: 'vm' },
        probe: NO_DOCKER,
        scope: 'full',
      }).unexecuted,
    ).toMatch(/unknown/);
  });
});

describe('the partial engine test', () => {
  it('runs only the engine suite and says it is partial', () => {
    const plan = planEngineRun({
      environment: { ATLAS_SEARCH_ENGINE_ARCHIVE: ARCHIVE },
      probe: WITH_DOCKER,
      scope: 'jar',
    });
    expect(plan).toMatchObject({
      files: [ENGINE_SUITE],
      label: 'test:engine:jar',
      mode: 'local',
      partial: true,
      required: [ENGINE_SUITE],
    });
    expect(plan.notes.join(' ')).toMatch(/PARTIAL/);
    expect(plan.notes.join(' ')).toMatch(/does not cover it/);
  });

  it('is unexecuted without an archive, and never stands in for container mode', () => {
    expect(planEngineRun({ environment: {}, probe: WITH_DOCKER, scope: 'jar' }).unexecuted).toMatch(
      /ATLAS_SEARCH_ENGINE_ARCHIVE/,
    );
    expect(
      planEngineRun({
        environment: { ATLAS_ENGINE_TEST_MODE: 'container', ATLAS_SEARCH_ENGINE_ARCHIVE: ARCHIVE },
        probe: WITH_DOCKER,
        scope: 'jar',
      }).unexecuted,
    ).toMatch(/only in local mode/);
  });
});

describe('the test report check', () => {
  it('accepts required suites whose every test passed', () => {
    const report = { testResults: [suite(PIPELINE_SUITE, ['passed', 'passed'])] };
    expect(reportProblems(report, [PIPELINE_SUITE])).toEqual([]);
  });

  it('refuses a suite that was skipped, as a mis-set mode silently does', () => {
    // The shape vitest reports when the pipeline suite is skipped: success, and nothing ran.
    const report = {
      success: true,
      testResults: [
        suite(ENGINE_SUITE, ['skipped', 'skipped']),
        suite(PIPELINE_SUITE, ['skipped', 'skipped', 'skipped', 'skipped', 'skipped']),
      ],
    };
    expect(reportProblems(report, [PIPELINE_SUITE])).toEqual([
      `${PIPELINE_SUITE}: 5 skipped of 5 tests.`,
    ]);
  });

  it('refuses a partly skipped suite, a missing suite, an empty one and no report', () => {
    const report = {
      testResults: [suite(ENGINE_SUITE, ['passed', 'skipped']), suite(PIPELINE_SUITE, [])],
    };
    expect(reportProblems(report, [ENGINE_SUITE, PIPELINE_SUITE])).toEqual([
      `${ENGINE_SUITE}: 1 skipped of 2 tests.`,
      `${PIPELINE_SUITE}: no tests ran.`,
    ]);
    expect(reportProblems({ testResults: [] }, [PIPELINE_SUITE])).toEqual([
      `${PIPELINE_SUITE}: not run.`,
    ]);
    expect(reportProblems(null, [PIPELINE_SUITE])).toEqual([
      'the test report is missing or unreadable.',
    ]);
  });
});

describe('the engine test command', () => {
  /** Runs the command with no Docker client and no Java runtime on its path. */
  async function command(args: readonly string[], environment: Record<string, string>) {
    const empty = await mkdtemp(join(tmpdir(), 'atlas-os-empty-path-'));
    try {
      return spawnSync(process.execPath, [resolve('scripts/test-engine.mjs'), ...args], {
        encoding: 'utf8',
        env: { PATH: empty, ...environment },
      });
    } finally {
      await rm(empty, { force: true, recursive: true });
    }
  }

  it('exits unexecuted, not passed, when local mode lacks the database build', async () => {
    const result = await command([], {
      ATLAS_ENGINE_TEST_MODE: 'local',
      ATLAS_SEARCH_ENGINE_ARCHIVE: ARCHIVE,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('test:engine UNEXECUTED');
    expect(result.stderr).toContain('ATLAS_SEARCH_BUILD_SCRIPT');
  });

  it('exits unexecuted in container mode without a Docker daemon', async () => {
    const result = await command([], { ATLAS_ENGINE_TEST_MODE: 'container' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('container mode needs a reachable Docker daemon');
  });

  it('exits unexecuted for the partial test without a runtime', async () => {
    const result = await command(['--jar'], { ATLAS_SEARCH_ENGINE_ARCHIVE: ARCHIVE });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('test:engine:jar UNEXECUTED');
  });
});
