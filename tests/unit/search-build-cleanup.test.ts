import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('../../infra/images/search-build/build-dump.sh', import.meta.url),
);

function executable(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

/** A local command harness: no PostgreSQL daemon, network access or Docker required. */
function runBuild(mode: 'success' | 'stop-fails' | 'killed') {
  const root = mkdtempSync(join(tmpdir(), 'atlas-search-build-cleanup-'));
  const work = join(root, 'work');
  const pgBin = join(root, 'pg-bin');
  const venvBin = join(root, 'venv', 'bin');
  mkdirSync(work);
  mkdirSync(pgBin);
  mkdirSync(venvBin, { recursive: true });
  executable(join(pgBin, 'initdb'), 'mkdir -p "$2"');
  executable(
    join(pgBin, 'pg_ctl'),
    [
      'DATA=$2',
      'case " $* " in',
      '  *" start "*)',
      '    touch "$DATA/postmaster.pid"',
      '    if [ "$ATLAS_TEST_KILL_BUILD" = 1 ]; then',
      '      kill -KILL "$(ps -o ppid= -p $$)"',
      '    fi;;',
      '  *" stop "*)',
      '    printf "stop attempted\\n" >> "$ATLAS_TEST_MARKER"',
      '    if [ "$ATLAS_TEST_STOP_FAIL" = 1 ]; then exit 41; fi',
      '    rm "$DATA/postmaster.pid";;',
      'esac',
    ].join('\n'),
  );
  executable(join(pgBin, 'psql'), 'printf "3\\n"');
  executable(join(venvBin, 'nominatim'), 'exit 0');
  executable(
    join(root, 'java'),
    [
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = "-export-file" ]; then',
      '    shift',
      '    printf "fixture\\n" > "$1"',
      '    exit 0',
      '  fi',
      '  shift',
      'done',
      'exit 1',
    ].join('\n'),
  );
  writeFileSync(join(root, 'input.osm.pbf'), 'fixture');
  writeFileSync(join(root, 'engine.jar'), 'fixture');

  try {
    const result = spawnSync('/bin/sh', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ATLAS_BUILD_INPUT: join(root, 'input.osm.pbf'),
        ATLAS_BUILD_WORK: work,
        ATLAS_BUILD_PG_BIN: pgBin,
        ATLAS_BUILD_VENV: join(root, 'venv'),
        ATLAS_BUILD_ENGINE_ARCHIVE: join(root, 'engine.jar'),
        ATLAS_BUILD_JAVA: join(root, 'java'),
        ATLAS_BUILD_THREADS: '1',
        ATLAS_TEST_MARKER: join(root, 'attempts'),
        ATLAS_TEST_STOP_FAIL: mode === 'stop-fails' ? '1' : '0',
        ATLAS_TEST_KILL_BUILD: mode === 'killed' ? '1' : '0',
      },
    });
    return {
      code: result.status,
      signal: result.signal,
      stderr: result.stderr,
      attempts: existsSync(join(root, 'attempts'))
        ? readFileSync(join(root, 'attempts'), 'utf8').trim().split('\n').length
        : 0,
      clusterUnverified: existsSync(join(work, 'cluster-unverified')),
      clusterExists: existsSync(join(work, 'pg', 'postmaster.pid')),
      socketExists: existsSync(join(work, 'run')),
      reportExists: existsSync(join(work, 'build-report.json')),
    };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe.skipIf(process.platform === 'win32')('offline search database build cleanup', () => {
  it('removes the cluster after a successful stop', () => {
    expect(runBuild('success')).toMatchObject({
      attempts: 1,
      clusterExists: false,
      clusterUnverified: false,
      code: 0,
      reportExists: true,
      socketExists: false,
    });
  });

  it('fails and preserves the running cluster files when stop fails', () => {
    const result = runBuild('stop-fails');
    expect(result).toMatchObject({
      attempts: 2,
      clusterExists: true,
      clusterUnverified: true,
      code: 41,
      reportExists: false,
      socketExists: true,
    });
    expect(result.stderr).toContain('PostgreSQL did not stop; preserving its work directory.');
  });

  it('keeps the unverified marker when the builder is killed without cleanup', () => {
    expect(runBuild('killed')).toMatchObject({
      attempts: 0,
      clusterExists: true,
      clusterUnverified: true,
      code: null,
      reportExists: false,
      signal: 'SIGKILL',
      socketExists: true,
    });
  });
});
