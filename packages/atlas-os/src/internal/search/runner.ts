import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GeographicBounds } from '../../contracts.js';
import { PlatformError } from '../../errors.js';
import type { SearchProbe } from '../../snapshot.js';
import { searchProbesSchema } from '../../snapshot.js';
import { sha256File } from '../fs/checksum.js';
import type { ProbeCandidate } from './dump/postprocess.js';
import type { ExpectedTree } from './host/copy.js';
import { engineServeCommand } from './host/engine.js';
import { LoadFailure } from './host/verify.js';
import { selectProbesWithEngine } from './probes.js';
import type { SearchToolConfig } from './tools.js';
import {
  DATABASE_BUILDER_VERSION,
  ENGINE_ARCHIVE_BYTES,
  ENGINE_ARCHIVE_SHA256,
  ENGINE_VERSION,
  INDEX_EXTRA_TAGS,
  INDEX_LANGUAGES,
  SEARCH_BUILD_IMAGE,
  SEARCH_RUNTIME_IMAGE,
} from './tools.js';

export interface ToolIdentity {
  readonly name: string;
  readonly version: string;
  readonly sha256?: string;
}

export interface ProbeSelection {
  readonly sealedEngine: string;
  readonly workDirectory: string;
  readonly bounds: GeographicBounds;
  readonly candidates: readonly ProbeCandidate[];
  readonly canary: { readonly latitude: number; readonly longitude: number };
  readonly expected: ExpectedTree;
  readonly importDate: string;
  readonly marker: string;
}

/**
 * Runs the provisioning-only search tools: the database export for a regional extract, the
 * engine import, and build-time probe selection. Never part of a serving process.
 */
export interface SearchToolRunner {
  readonly tools: readonly ToolIdentity[];
  /** Writes the raw database export for an extract to `<workDirectory>/dump.jsonl`. */
  buildDump(options: { readonly extract: string; readonly workDirectory: string }): Promise<{
    readonly dump: string;
  }>;
  importDump(options: {
    readonly dump: string;
    readonly engineDirectory: string;
    readonly workDirectory: string;
  }): Promise<void>;
  selectProbes(options: ProbeSelection): Promise<SearchProbe[]>;
}

export const ENGINE_TOOL: ToolIdentity = {
  name: 'engine',
  sha256: ENGINE_ARCHIVE_SHA256,
  version: ENGINE_VERSION,
};
export const DATABASE_BUILDER_TOOL: ToolIdentity = {
  name: 'database-builder',
  version: DATABASE_BUILDER_VERSION,
};

function toolFailure(stage: string, details: Record<string, unknown> = {}): PlatformError {
  return new PlatformError('INTERNAL_ERROR', 'A search provisioning tool failed.', {
    details: { stage, ...details },
  });
}

/** The hard limits a container ran under, reported with its failure so it can be resized. */
interface ContainerLimits {
  readonly memoryLimit: string;
  readonly pidsLimit: number;
  readonly heap: string;
}

/**
 * What a failed tool's status says about its limits. A container ended by a signal reports 137:
 * with a memory limit set and no network, that is almost always the limit. The runtime reports 3
 * when its heap is exhausted or it cannot create a thread, which the PID limit also causes.
 */
function limitDetails(code: number | null, limits: ContainerLimits): Record<string, unknown> {
  const reason =
    code === 137 ? 'killed_by_signal' : code === 3 ? 'runtime_out_of_memory' : undefined;
  return {
    ...(reason === undefined ? {} : { reason }),
    limits: { heap: limits.heap, memory: limits.memoryLimit, pids: limits.pidsLimit },
  };
}

function run(
  stage: string,
  command: string,
  args: readonly string[],
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly cwd?: string;
    readonly limits?: ContainerLimits;
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Tool output goes to the operator's standard error, so it can never corrupt the single
    // JSON document the command-line tool prints on standard output.
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 2, 2],
    });
    child.on('error', (error) =>
      reject(
        new PlatformError('INTERNAL_ERROR', 'A search provisioning tool could not be started.', {
          cause: error,
          details: { stage },
        }),
      ),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            toolFailure(stage, {
              exitCode: code,
              ...(options.limits === undefined ? {} : limitDetails(code, options.limits)),
            }),
          ),
    );
  });
}

function importArguments(
  config: SearchToolConfig,
  paths: {
    readonly dump: string;
    readonly engine: string;
    readonly tmp: string;
    readonly archive: string;
    readonly home: string;
  },
): string[] {
  return [
    `-Xmx${config.importHeap}`,
    '-XX:+ExitOnOutOfMemoryError',
    `-Duser.home=${paths.home}`,
    `-Djava.io.tmpdir=${paths.tmp}`,
    '-jar',
    paths.archive,
    'import',
    '-import-file',
    paths.dump,
    '-data-dir',
    paths.engine,
    '-languages',
    INDEX_LANGUAGES.join(','),
    '-extra-tags',
    INDEX_EXTRA_TAGS.join(','),
    '-j',
    String(config.threads),
  ];
}

/** A minimal, explicit environment for local tools: nothing from the operator's shell leaks in. */
function toolEnvironment(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    HOME: home,
    LANG: 'C.UTF-8',
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    TMPDIR: join(home, 'tmp'),
    ...extra,
  };
}

/**
 * Runs the tools directly on this machine: the engine archive with a local runtime, and, for a
 * regional extract, the same build script the provisioning image runs, with the database tools
 * this machine provides. The archive is verified against its pinned digest before every use.
 */
export class LocalSearchToolRunner implements SearchToolRunner {
  readonly #config: SearchToolConfig;
  readonly tools: readonly ToolIdentity[];

  constructor(config: SearchToolConfig) {
    this.#config = config;
    this.tools =
      config.kind === 'external'
        ? [ENGINE_TOOL, DATABASE_BUILDER_TOOL]
        : [ENGINE_TOOL, { name: 'synthetic-dump', version: '1' }];
  }

  async #archive(): Promise<string> {
    const archive = this.#config.engineArchive;
    if (archive === undefined) {
      throw new PlatformError(
        'VALIDATION_FAILED',
        'Local search tooling needs the engine archive.',
        {
          details: { variable: 'ATLAS_SEARCH_ENGINE_ARCHIVE' },
        },
      );
    }
    const details = await stat(archive).catch(() => undefined);
    if (
      details === undefined ||
      details.size !== ENGINE_ARCHIVE_BYTES ||
      (await sha256File(archive)) !== ENGINE_ARCHIVE_SHA256
    ) {
      throw new PlatformError(
        'VALIDATION_FAILED',
        'The engine archive does not match its pinned digest.',
        { details: { variable: 'ATLAS_SEARCH_ENGINE_ARCHIVE' } },
      );
    }
    return archive;
  }

  async #home(workDirectory: string): Promise<string> {
    const home = join(workDirectory, 'home');
    await mkdir(join(home, 'tmp'), { recursive: true });
    return home;
  }

  async buildDump(options: { readonly extract: string; readonly workDirectory: string }) {
    const script = this.#config.buildScript;
    if (script === undefined) {
      throw new PlatformError('VALIDATION_FAILED', 'Local search tooling needs its build script.', {
        details: { variable: 'ATLAS_SEARCH_BUILD_SCRIPT' },
      });
    }
    const archive = await this.#archive();
    const work = join(options.workDirectory, 'database');
    await mkdir(work, { recursive: true });
    const home = await this.#home(options.workDirectory);
    await run('database_export', '/bin/sh', [script], {
      cwd: home,
      env: toolEnvironment(home, {
        ...this.#config.buildEnvironment,
        ATLAS_BUILD_ENGINE_ARCHIVE: archive,
        ATLAS_BUILD_INPUT: options.extract,
        ATLAS_BUILD_JAVA: this.#config.javaExecutable,
        ATLAS_BUILD_THREADS: String(this.#config.threads),
        ATLAS_BUILD_WORK: work,
      }),
    });
    return { dump: join(work, 'dump.jsonl') };
  }

  async importDump(options: {
    readonly dump: string;
    readonly engineDirectory: string;
    readonly workDirectory: string;
  }): Promise<void> {
    const archive = await this.#archive();
    const home = await this.#home(options.workDirectory);
    await mkdir(options.engineDirectory, { recursive: true });
    await run(
      'engine_import',
      this.#config.javaExecutable,
      importArguments(this.#config, {
        archive,
        dump: options.dump,
        engine: options.engineDirectory,
        home,
        tmp: join(home, 'tmp'),
      }),
      { cwd: home, env: toolEnvironment(home) },
    );
  }

  async selectProbes(options: ProbeSelection): Promise<SearchProbe[]> {
    const archive = await this.#archive();
    try {
      return await selectProbesWithEngine({
        engineCommand: engineServeCommand({
          engineArchive: archive,
          heap: this.#config.importHeap,
          javaExecutable: this.#config.javaExecutable,
        }),
        request: options,
        sealedEngine: options.sealedEngine,
        workRoot: join(options.workDirectory, 'probe'),
      });
    } catch (error) {
      if (error instanceof LoadFailure)
        throw toolFailure('probe_selection', { reason: error.reason });
      throw error;
    }
  }
}

/** The invoking user, so files written into the staging tree are the operator's own. */
function containerUser(): string {
  return `${process.getuid?.() ?? 10001}:${process.getgid?.() ?? 10001}`;
}

/** Every provisioning container runs with no network, no capabilities and a read-only root. */
const HARDENING = [
  '--rm',
  '--network=none',
  '--cap-drop=ALL',
  '--security-opt=no-new-privileges:true',
  '--read-only',
  '--tmpfs=/tmp:rw,size=512m',
] as const;

/** Hard, operator-set limits: memory with no swap beyond it, and a ceiling on processes. */
function limitArguments(config: SearchToolConfig): string[] {
  return [
    `--memory=${config.memoryLimit}`,
    `--memory-swap=${config.memoryLimit}`,
    `--pids-limit=${config.pidsLimit}`,
  ];
}

/**
 * Runs each tool in its pinned local image: the database export and the engine import in the
 * provisioning image, and probe selection in the serving image, exactly as the host will run it.
 */
export class ContainerSearchToolRunner implements SearchToolRunner {
  readonly #config: SearchToolConfig;
  readonly #docker: string;
  readonly #limits: ContainerLimits;
  readonly tools: readonly ToolIdentity[];

  constructor(config: SearchToolConfig, docker = 'docker') {
    this.#config = config;
    this.#docker = docker;
    this.#limits = {
      heap: config.importHeap,
      memoryLimit: config.memoryLimit,
      pidsLimit: config.pidsLimit,
    };
    this.tools =
      config.kind === 'external'
        ? [ENGINE_TOOL, DATABASE_BUILDER_TOOL]
        : [ENGINE_TOOL, { name: 'synthetic-dump', version: '1' }];
  }

  /** The exact command lines, exposed so they can be asserted without running a container. */
  buildDumpInvocation(extract: string, work: string): readonly string[] {
    return [
      'run',
      ...HARDENING,
      ...limitArguments(this.#config),
      '--shm-size=1g',
      '--user',
      containerUser(),
      '--volume',
      `${extract}:/input/region.osm.pbf:ro`,
      '--volume',
      `${work}:/work`,
      '--env',
      `ATLAS_BUILD_THREADS=${this.#config.threads}`,
      SEARCH_BUILD_IMAGE,
    ];
  }

  importInvocation(dumpDirectory: string, dumpName: string, engine: string): readonly string[] {
    return [
      'run',
      ...HARDENING,
      ...limitArguments(this.#config),
      '--user',
      containerUser(),
      '--volume',
      `${dumpDirectory}:/dump:ro`,
      '--volume',
      `${engine}:/engine`,
      '--entrypoint',
      'java',
      SEARCH_BUILD_IMAGE,
      ...importArguments(this.#config, {
        archive: '/opt/atlas-os/engine/engine.jar',
        dump: `/dump/${dumpName}`,
        engine: '/engine',
        home: '/tmp',
        tmp: '/tmp',
      }),
    ];
  }

  probeInvocation(sealed: string, work: string): readonly string[] {
    return [
      'run',
      ...HARDENING,
      ...limitArguments(this.#config),
      '--user',
      containerUser(),
      '--volume',
      `${sealed}:/sealed:ro`,
      '--volume',
      `${work}:/work`,
      '--env',
      'ATLAS_SEARCH_PROBE_DATA=/sealed',
      '--env',
      'ATLAS_SEARCH_PROBE_REQUEST=/work/request.json',
      '--env',
      'ATLAS_SEARCH_PROBE_RESULT=/work/probes.json',
      '--env',
      'ATLAS_SEARCH_WORK_ROOT=/work/engine',
      '--env',
      `ATLAS_SEARCH_ENGINE_HEAP=${this.#config.importHeap}`,
      SEARCH_RUNTIME_IMAGE,
      'node',
      'dist/index.js',
      'select-probes',
    ];
  }

  async buildDump(options: { readonly extract: string; readonly workDirectory: string }) {
    const work = join(options.workDirectory, 'database');
    await mkdir(work, { recursive: true });
    await run('database_export', this.#docker, this.buildDumpInvocation(options.extract, work), {
      limits: this.#limits,
    });
    return { dump: join(work, 'dump.jsonl') };
  }

  async importDump(options: {
    readonly dump: string;
    readonly engineDirectory: string;
    readonly workDirectory: string;
  }): Promise<void> {
    await mkdir(options.engineDirectory, { recursive: true });
    const separator = Math.max(options.dump.lastIndexOf('/'), options.dump.lastIndexOf('\\'));
    await run(
      'engine_import',
      this.#docker,
      this.importInvocation(
        options.dump.slice(0, separator),
        options.dump.slice(separator + 1),
        options.engineDirectory,
      ),
      { limits: this.#limits },
    );
  }

  async selectProbes(options: ProbeSelection): Promise<SearchProbe[]> {
    const work = join(options.workDirectory, 'probe');
    await mkdir(work, { recursive: true });
    const request = {
      bounds: options.bounds,
      candidates: options.candidates,
      canary: options.canary,
      expected: options.expected,
      importDate: options.importDate,
      marker: options.marker,
    };
    await writeFile(join(work, 'request.json'), JSON.stringify(request));
    await run('probe_selection', this.#docker, this.probeInvocation(options.sealedEngine, work), {
      limits: this.#limits,
    });
    const parsed = searchProbesSchema.safeParse(
      JSON.parse(await readFile(join(work, 'probes.json'), 'utf8')),
    );
    if (!parsed.success) throw toolFailure('probe_selection');
    return parsed.data;
  }
}

export function createSearchToolRunner(config: SearchToolConfig): SearchToolRunner {
  return config.mode === 'local'
    ? new LocalSearchToolRunner(config)
    : new ContainerSearchToolRunner(config);
}
