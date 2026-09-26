import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the search engine tests against the real, pinned engine.
 *
 * `pnpm test:engine` is the end-to-end gate: it passes only when the tiny-extract pipeline ran
 * and passed. Container mode (Docker available) builds the provisioning and serving images from
 * this repository and runs the whole pipeline and the host in them, with no network. Local mode
 * needs the engine archive, a Java runtime and a working local database build
 * (`ATLAS_SEARCH_BUILD_SCRIPT`), and also runs the synthetic engine suite.
 *
 * `pnpm test:engine:jar` is a partial run, named as one: the synthetic fixture through the real
 * engine and host with a local runtime, and no database build. Its result never covers the
 * pipeline.
 *
 * Either command reads the test report and fails when a test it requires was skipped or never
 * ran, so a suite can never pass by not running. Exit status 2 means the command could not be
 * executed here at all. That is never a pass.
 */
const root = resolve(import.meta.dirname, '..');

export const ENGINE_SUITE = 'tests/engine/engine.test.ts';
export const PIPELINE_SUITE = 'tests/engine/pipeline.test.ts';

/**
 * Decides what a run covers from the environment, or why it cannot run. `probe` answers whether
 * Docker and a Java runtime are usable, and is asked only when the answer matters.
 */
export function planEngineRun({ scope, environment, probe }) {
  const label = scope === 'jar' ? 'test:engine:jar' : 'test:engine';
  const unexecuted = (reason) => ({ label, unexecuted: reason });
  const archive = environment.ATLAS_SEARCH_ENGINE_ARCHIVE;
  const localPrerequisites = () => {
    if (!archive) return 'local mode needs ATLAS_SEARCH_ENGINE_ARCHIVE.';
    const java = environment.ATLAS_SEARCH_ENGINE_JAVA || 'java';
    if (!probe.java(java)) return `local mode needs a Java runtime (${java}).`;
    return null;
  };

  if (scope === 'jar') {
    const mode = environment.ATLAS_ENGINE_TEST_MODE;
    if (mode !== undefined && mode !== '' && mode !== 'local') {
      return unexecuted('the partial engine test runs only in local mode.');
    }
    const missing = localPrerequisites();
    if (missing !== null) return unexecuted(missing);
    return {
      files: [ENGINE_SUITE],
      label,
      mode: 'local',
      notes: [
        'PARTIAL: the synthetic fixture through the real engine and host only.',
        'The tiny-extract pipeline is not run, and this result does not cover it; `pnpm test:engine` does.',
      ],
      partial: true,
      required: [ENGINE_SUITE],
    };
  }

  let mode = environment.ATLAS_ENGINE_TEST_MODE || undefined;
  if (mode === undefined) {
    if (probe.docker()) mode = 'container';
    else if (archive) mode = 'local';
    else {
      return unexecuted(
        'no Docker daemon is reachable and ATLAS_SEARCH_ENGINE_ARCHIVE is not set for local mode.',
      );
    }
  }
  if (mode === 'container') {
    if (!probe.docker()) return unexecuted('container mode needs a reachable Docker daemon.');
    return {
      files: [PIPELINE_SUITE],
      label,
      mode,
      notes: [
        'pipeline: tiny extract through the provisioning and serving images.',
        'engine: the synthetic suite needs a local runtime and runs under `pnpm test:engine:jar`.',
      ],
      partial: false,
      required: [PIPELINE_SUITE],
    };
  }
  if (mode === 'local') {
    if (!environment.ATLAS_SEARCH_BUILD_SCRIPT) {
      return unexecuted(
        'the tiny-extract pipeline needs ATLAS_SEARCH_BUILD_SCRIPT in local mode. `pnpm test:engine:jar` runs the engine and host alone, reported as partial.',
      );
    }
    const missing = localPrerequisites();
    if (missing !== null) return unexecuted(missing);
    return {
      files: [ENGINE_SUITE, PIPELINE_SUITE],
      label,
      mode,
      notes: [
        'engine: synthetic fixture through the real engine and host.',
        'pipeline: tiny extract through the local database build.',
      ],
      partial: false,
      required: [ENGINE_SUITE, PIPELINE_SUITE],
    };
  }
  return unexecuted(`unknown ATLAS_ENGINE_TEST_MODE '${mode}'.`);
}

/**
 * Checks a test report against what a run requires: every required suite reported, with at
 * least one test, and every one of its tests passed. A skipped test is a problem, not a pass.
 */
export function reportProblems(report, required) {
  const problems = [];
  if (report === null || typeof report !== 'object' || !Array.isArray(report.testResults)) {
    return ['the test report is missing or unreadable.'];
  }
  for (const suite of required) {
    const result = report.testResults.find((entry) =>
      String(entry.name).replaceAll('\\', '/').endsWith(`/${suite}`),
    );
    if (result === undefined) {
      problems.push(`${suite}: not run.`);
      continue;
    }
    const statuses = (result.assertionResults ?? []).map((assertion) => assertion.status);
    if (statuses.length === 0) {
      problems.push(`${suite}: no tests ran.`);
      continue;
    }
    const notPassed = statuses.filter((status) => status !== 'passed');
    if (notPassed.length > 0) {
      const counts = {};
      for (const status of notPassed) counts[status] = (counts[status] ?? 0) + 1;
      const described = Object.entries(counts)
        .map(([status, count]) => `${count} ${status}`)
        .join(', ');
      problems.push(`${suite}: ${described} of ${statuses.length} tests.`);
    }
  }
  return problems;
}

function available(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0;
}

function step(command, args, env = process.env) {
  process.stdout.write(`$ ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  return result.status ?? 1;
}

async function main() {
  const scope = process.argv.includes('--jar') ? 'jar' : 'full';
  let docker;
  const plan = planEngineRun({
    environment: process.env,
    probe: {
      docker: () => (docker ??= available('docker', ['info'])),
      java: (java) => available(java, ['-version']),
    },
    scope,
  });
  if (plan.unexecuted !== undefined) {
    process.stderr.write(`${plan.label} UNEXECUTED: ${plan.unexecuted}\n`);
    return 2;
  }
  for (const note of plan.notes) process.stdout.write(`${plan.label} ${note}\n`);

  if (plan.mode === 'container') {
    for (const [file, tag] of [
      ['infra/images/search-build.Dockerfile', 'atlas-os/search-build:m2'],
      ['infra/images/search.Dockerfile', 'atlas-os/search:m2'],
    ]) {
      const status = step('docker', ['build', '--file', file, '--tag', tag, '.']);
      if (status !== 0) return status;
    }
  }

  const scratch = await mkdtemp(join(tmpdir(), 'atlas-os-engine-report-'));
  const measurements = join(scratch, 'measurements.jsonl');
  const results = join(scratch, 'results.json');
  try {
    const status = step(
      process.execPath,
      [
        resolve(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        ...plan.files,
        // The embedded engine binds fixed loopback ports, so engines must never run concurrently
        // on one machine: the files run one after another.
        '--no-file-parallelism',
        '--testTimeout=900000',
        '--hookTimeout=600000',
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${results}`,
      ],
      {
        ...process.env,
        ATLAS_ENGINE_TEST_MODE: plan.mode,
        ATLAS_ENGINE_TEST_REPORT: measurements,
      },
    );
    const measured = await readFile(measurements, 'utf8').catch(() => '');
    for (const line of measured.split('\n').filter((entry) => entry.length > 0)) {
      process.stdout.write(`${plan.label} measured ${line}\n`);
    }
    if (status !== 0) return status;

    const report = await readFile(results, 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => null);
    const problems = reportProblems(report, plan.required);
    if (problems.length > 0) {
      for (const problem of problems) process.stderr.write(`${plan.label} FAILED: ${problem}\n`);
      process.stderr.write(`${plan.label} FAILED: a required suite did not run and pass.\n`);
      return 1;
    }
    process.stdout.write(
      plan.partial
        ? `${plan.label} PASSED (PARTIAL): ${plan.required.join(', ')}. The tiny-extract pipeline was not run.\n`
        : `${plan.label} PASSED: ${plan.required.join(', ')} in ${plan.mode} mode.\n`,
    );
    return 0;
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
