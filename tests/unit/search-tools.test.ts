import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ContainerSearchToolRunner } from '../../packages/atlas-os/src/internal/search/runner.js';
import type { SearchToolConfig } from '../../packages/atlas-os/src/internal/search/tools.js';
import { readSearchToolConfig } from '../../packages/atlas-os/src/internal/search/tools.js';

const HARDENING = [
  '--rm',
  '--network=none',
  '--cap-drop=ALL',
  '--security-opt=no-new-privileges:true',
  '--read-only',
  '--tmpfs=/tmp:rw,size=512m',
];

const LIMITS = ['--memory=4g', '--memory-swap=4g', '--pids-limit=4096'];

function config(overrides: Partial<SearchToolConfig> = {}): SearchToolConfig {
  return {
    buildEnvironment: {},
    buildScript: undefined,
    engineArchive: undefined,
    importHeap: '2g',
    javaExecutable: 'java',
    kind: 'external',
    memoryLimit: '4g',
    mode: 'container',
    pidsLimit: 4096,
    threads: 4,
    ...overrides,
  };
}

describe('search tooling configuration', () => {
  it('follows the basemap tooling by default', () => {
    expect(readSearchToolConfig({}, 'external')).toMatchObject({
      kind: 'external',
      mode: 'container',
    });
    expect(readSearchToolConfig({}, 'synthetic')).toMatchObject({ kind: 'none' });
    expect(
      readSearchToolConfig({ ATLAS_SEARCH_TOOL_KIND: 'synthetic' }, 'synthetic'),
    ).toMatchObject({ kind: 'synthetic' });
    expect(readSearchToolConfig({ ATLAS_SEARCH_TOOL_KIND: 'none' }, 'external')).toMatchObject({
      kind: 'none',
    });
  });

  it.each([
    [{ ATLAS_SEARCH_TOOL_KIND: 'synthetic' }, 'external'],
    [{ ATLAS_SEARCH_TOOL_KIND: 'external' }, 'synthetic'],
    [{ ATLAS_SEARCH_TOOL_KIND: 'photon' }, 'external'],
    [{ ATLAS_SEARCH_TOOL_MODE: 'jar' }, 'external'],
    [{ ATLAS_SEARCH_IMPORT_HEAP: '2 g' }, 'external'],
    [{ ATLAS_SEARCH_BUILD_THREADS: '0' }, 'external'],
    [{ ATLAS_SEARCH_ENGINE_ARCHIVE: 'engine.jar' }, 'external'],
    [{ ATLAS_SEARCH_BUILD_SCRIPT: 'build.sh' }, 'external'],
    [{ ATLAS_SEARCH_TOOL_MEMORY_LIMIT: 'unlimited' }, 'external'],
    [{ ATLAS_SEARCH_TOOL_MEMORY_LIMIT: '-1' }, 'external'],
    [{ ATLAS_SEARCH_TOOL_MEMORY_LIMIT: '2g' }, 'external'],
    [{ ATLAS_SEARCH_IMPORT_HEAP: '6g', ATLAS_SEARCH_TOOL_MEMORY_LIMIT: '6144m' }, 'external'],
    [{ ATLAS_SEARCH_TOOL_PIDS_LIMIT: '0' }, 'external'],
    [{ ATLAS_SEARCH_TOOL_PIDS_LIMIT: '-1' }, 'external'],
  ] as const)('refuses %j with %s tiles', (environment, tiles) => {
    expect(() => readSearchToolConfig(environment, tiles)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it('bounds every provisioning container by default and lets the operator set the bounds', () => {
    expect(readSearchToolConfig({}, 'external')).toMatchObject({
      importHeap: '2g',
      memoryLimit: '4g',
      pidsLimit: 4096,
    });
    expect(
      readSearchToolConfig(
        {
          ATLAS_SEARCH_IMPORT_HEAP: '6g',
          ATLAS_SEARCH_TOOL_MEMORY_LIMIT: '9g',
          ATLAS_SEARCH_TOOL_PIDS_LIMIT: '2048',
        },
        'external',
      ),
    ).toMatchObject({ importHeap: '6g', memoryLimit: '9g', pidsLimit: 2048 });
  });

  it('passes only build-script settings through to the local build', () => {
    const read = readSearchToolConfig(
      {
        ATLAS_BUILD_PG_BIN: '/usr/lib/postgresql/16/bin',
        ATLAS_BUILD_VENV: '/opt/venv',
        ATLAS_SEARCH_TOOL_MODE: 'local',
        HOME: '/home/operator',
        JAVA_TOOL_OPTIONS: '-Dhttps.proxyHost=proxy',
      },
      'external',
    );
    expect(read.buildEnvironment).toEqual({
      ATLAS_BUILD_PG_BIN: '/usr/lib/postgresql/16/bin',
      ATLAS_BUILD_VENV: '/opt/venv',
    });
  });
});

describe('container search tooling', () => {
  const runner = new ContainerSearchToolRunner(config());
  const user = `${process.getuid?.() ?? 10001}:${process.getgid?.() ?? 10001}`;

  it('exports the database with no network and the extract mounted read-only', () => {
    expect(runner.buildDumpInvocation('/data/iran.osm.pbf', '/staging/work/database')).toEqual([
      'run',
      ...HARDENING,
      ...LIMITS,
      '--shm-size=1g',
      '--user',
      user,
      '--volume',
      '/data/iran.osm.pbf:/input/region.osm.pbf:ro',
      '--volume',
      '/staging/work/database:/work',
      '--env',
      'ATLAS_BUILD_THREADS=4',
      'atlas-os/search-build:m2',
    ]);
  });

  it('imports with the private variant language and only the fields the host needs', () => {
    expect(
      runner.importInvocation('/staging/work', 'dump.jsonl', '/staging/search/engine'),
    ).toEqual([
      'run',
      ...HARDENING,
      ...LIMITS,
      '--user',
      user,
      '--volume',
      '/staging/work:/dump:ro',
      '--volume',
      '/staging/search/engine:/engine',
      '--entrypoint',
      'java',
      'atlas-os/search-build:m2',
      '-Xmx2g',
      '-XX:+ExitOnOutOfMemoryError',
      '-Duser.home=/tmp',
      '-Djava.io.tmpdir=/tmp',
      '-jar',
      '/opt/atlas-os/engine/engine.jar',
      'import',
      '-import-file',
      '/dump/dump.jsonl',
      '-data-dir',
      '/engine',
      '-languages',
      'fa,en,qaa',
      '-extra-tags',
      'atlas_generation,atlas_housenumber,atlas_postcode',
      '-j',
      '4',
    ]);
  });

  it('selects probes in the serving image against a read-only sealed tree', () => {
    const args = runner.probeInvocation('/staging/search/engine', '/staging/work/probe');
    expect(args.slice(0, HARDENING.length + LIMITS.length + 1)).toEqual([
      'run',
      ...HARDENING,
      ...LIMITS,
    ]);
    expect(args).toContain('/staging/search/engine:/sealed:ro');
    expect(args.slice(-4)).toEqual([
      'atlas-os/search:m2',
      'node',
      'dist/index.js',
      'select-probes',
    ]);
    expect(args.join(' ')).not.toMatch(/--publish|-p |--network=(?!none)/);
  });

  it.skipIf(process.platform === 'win32')(
    'reports the limits in force when a tool container is killed or runs out of memory',
    async () => {
      const scratch = await mkdtemp(join(tmpdir(), 'atlas-os-fake-docker-'));
      try {
        for (const [status, reason] of [
          [137, 'killed_by_signal'],
          [3, 'runtime_out_of_memory'],
        ] as const) {
          const docker = join(scratch, `docker-${status}`);
          await writeFile(docker, `#!/bin/sh\nexit ${status}\n`);
          await chmod(docker, 0o755);
          const limited = new ContainerSearchToolRunner(config(), docker);
          await expect(
            limited.importDump({
              dump: join(scratch, 'dump.jsonl'),
              engineDirectory: join(scratch, 'engine'),
              workDirectory: scratch,
            }),
          ).rejects.toMatchObject({
            details: {
              exitCode: status,
              limits: { heap: '2g', memory: '4g', pids: 4096 },
              reason,
              stage: 'engine_import',
            },
          });
        }
      } finally {
        await rm(scratch, { force: true, recursive: true });
      }
    },
  );
});
