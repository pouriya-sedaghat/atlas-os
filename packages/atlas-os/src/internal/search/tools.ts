import { availableParallelism } from 'node:os';
import { isAbsolute } from 'node:path';

import { PlatformError } from '../../errors.js';

/**
 * Pinned search tooling.
 *
 * Private to the platform package. Every constant was read from the pinned artifacts: the engine
 * archive is the published release asset for the tag, verified by digest and size, and the
 * database builder is the exact package version the provisioning image installs from its hash
 * lock.
 */
export const ENGINE_NAME = 'photon';
export const ENGINE_VERSION = '1.3.0';
export const ENGINE_ARCHIVE_SHA256 =
  'sha256:a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5';
export const ENGINE_ARCHIVE_BYTES = 98_219_380;
export const DATABASE_BUILDER_NAME = 'nominatim';
export const DATABASE_BUILDER_VERSION = '5.3.2';

/** Languages the engine indexes: the two public languages and the private canonical variants. */
export const INDEX_LANGUAGES = ['fa', 'en', 'qaa'] as const;
/** The only extra fields the engine keeps: the canary marker and the original spellings. */
export const INDEX_EXTRA_TAGS = [
  'atlas_generation',
  'atlas_housenumber',
  'atlas_postcode',
] as const;

/**
 * Local images the provisioning runner starts in container mode. Both are built from this
 * repository with every base image pinned by digest; neither is published.
 */
export const SEARCH_BUILD_IMAGE = 'atlas-os/search-build:m2';
export const SEARCH_RUNTIME_IMAGE = 'atlas-os/search:m2';

export type SearchToolKind = 'external' | 'synthetic' | 'none';
export type SearchToolMode = 'container' | 'local';

export interface SearchToolConfig {
  readonly kind: SearchToolKind;
  readonly mode: SearchToolMode;
  /** Local mode: the engine archive and the runtime that runs it. */
  readonly engineArchive: string | undefined;
  readonly javaExecutable: string;
  /** Local mode, regional extracts: the database build script. */
  readonly buildScript: string | undefined;
  readonly importHeap: string;
  readonly threads: number;
  /** Container mode: the hard memory limit of every provisioning container, with no swap. */
  readonly memoryLimit: string;
  /** Container mode: the most processes and threads any provisioning container may run. */
  readonly pidsLimit: number;
  /** Local mode: extra build settings passed through to the build script unchanged. */
  readonly buildEnvironment: Readonly<Record<string, string>>;
}

type Environment = Readonly<Record<string, string | undefined>>;

/** Bytes in a size such as `512m` or `4g`. */
export function sizeBytes(size: string): number {
  return Number(size.slice(0, -1)) * (size.endsWith('g') ? 1024 ** 3 : 1024 ** 2);
}

function invalid(variable: string): never {
  throw new PlatformError('VALIDATION_FAILED', 'Search tooling configuration is invalid.', {
    details: { variable },
  });
}

function optionalPath(environment: Environment, variable: string): string | undefined {
  const value = environment[variable];
  if (value === undefined || value === '') return undefined;
  if (!isAbsolute(value) || value.includes('\0')) invalid(variable);
  return value;
}

/**
 * Reads the search tooling configuration.
 *
 * The default follows the basemap tooling: a production preparation from a regional extract
 * builds search from the same extract; the synthetic basemap fixture stays basemap-only unless
 * synthetic search is asked for explicitly. Mixing a real extract with synthetic search, or
 * synthetic tiles with extract-based search, is refused: one snapshot has one source.
 */
export function readSearchToolConfig(
  environment: Environment,
  tileToolKind: 'external' | 'synthetic',
): SearchToolConfig {
  const rawKind = environment['ATLAS_SEARCH_TOOL_KIND'];
  const kind: SearchToolKind =
    rawKind === undefined || rawKind === ''
      ? tileToolKind === 'external'
        ? 'external'
        : 'none'
      : rawKind === 'external' || rawKind === 'synthetic' || rawKind === 'none'
        ? rawKind
        : invalid('ATLAS_SEARCH_TOOL_KIND');
  if (kind === 'external' && tileToolKind !== 'external') invalid('ATLAS_SEARCH_TOOL_KIND');
  if (kind === 'synthetic' && tileToolKind !== 'synthetic') invalid('ATLAS_SEARCH_TOOL_KIND');

  const rawMode = environment['ATLAS_SEARCH_TOOL_MODE'];
  const mode: SearchToolMode =
    rawMode === undefined || rawMode === ''
      ? 'container'
      : rawMode === 'container' || rawMode === 'local'
        ? rawMode
        : invalid('ATLAS_SEARCH_TOOL_MODE');

  const importHeap = environment['ATLAS_SEARCH_IMPORT_HEAP'] || '2g';
  if (!/^[1-9][0-9]{0,5}[mg]$/.test(importHeap)) invalid('ATLAS_SEARCH_IMPORT_HEAP');

  // Bounded by default, never unlimited. The defaults bound the containers; they are not a size
  // for any region, and an operator sets both from a measured run of their own extract.
  const memoryLimit = environment['ATLAS_SEARCH_TOOL_MEMORY_LIMIT'] || '4g';
  if (!/^[1-9][0-9]{0,5}[mg]$/.test(memoryLimit)) invalid('ATLAS_SEARCH_TOOL_MEMORY_LIMIT');
  // The runtime needs room beyond its heap, so a limit at or below the heap can never work.
  if (sizeBytes(memoryLimit) <= sizeBytes(importHeap)) invalid('ATLAS_SEARCH_TOOL_MEMORY_LIMIT');
  const rawPids = environment['ATLAS_SEARCH_TOOL_PIDS_LIMIT'] || '4096';
  if (!/^[1-9][0-9]{0,5}$/.test(rawPids)) invalid('ATLAS_SEARCH_TOOL_PIDS_LIMIT');

  const rawThreads = environment['ATLAS_SEARCH_BUILD_THREADS'];
  let threads = Math.max(1, Math.min(availableParallelism(), 8));
  if (rawThreads !== undefined && rawThreads !== '') {
    if (!/^[1-9][0-9]?$/.test(rawThreads)) invalid('ATLAS_SEARCH_BUILD_THREADS');
    threads = Number(rawThreads);
  }

  const javaExecutable = environment['ATLAS_SEARCH_ENGINE_JAVA'] || 'java';
  if (/[\s\0]/.test(javaExecutable)) invalid('ATLAS_SEARCH_ENGINE_JAVA');

  // Build settings the local build script understands, passed through without interpretation.
  const buildEnvironment: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (/^ATLAS_BUILD_[A-Z_]+$/.test(key) && value !== undefined && value !== '') {
      buildEnvironment[key] = value;
    }
  }

  return {
    buildEnvironment,
    buildScript: optionalPath(environment, 'ATLAS_SEARCH_BUILD_SCRIPT'),
    engineArchive: optionalPath(environment, 'ATLAS_SEARCH_ENGINE_ARCHIVE'),
    importHeap,
    javaExecutable,
    kind,
    memoryLimit,
    mode,
    pidsLimit: Number(rawPids),
    threads,
  };
}
