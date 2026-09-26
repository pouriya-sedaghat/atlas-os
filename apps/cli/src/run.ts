import { resolve } from 'node:path';

import {
  AppError,
  createApplicationComposition,
  createProvisioningComposition,
  type ApplicationComposition,
  type DatasetInput,
  type DoctorResult,
} from '@atlas-os/core';

import { parseArguments } from './arguments.js';
import { defaultInputName } from './input-name.js';
import type { ExitCode } from './exit-codes.js';
import { EXIT } from './exit-codes.js';

type JsonObject = Readonly<Record<string, unknown>>;

export interface CommandResult {
  readonly code: ExitCode;
  readonly output: JsonObject;
}

/**
 * Flags naming operator-supplied inputs.
 *
 * Each names the role the data plays, never the project that publishes it. Which of them a
 * preparation requires depends on the basemap content being built, and the platform refuses a
 * preparation that is missing one rather than producing an incomplete basemap.
 */
const INPUT_FLAGS = {
  'coastline-polygons': 'coastline_polygons',
  'lake-centerlines': 'lake_centerlines',
  'reference-features': 'reference_features',
  'region-extract': 'region_extract',
} as const;

/**
 * Maps parsed command-line flags onto the platform's neutral dataset inputs.
 *
 * Kept pure and exported so the mapping is directly provable: deciding what provenance a flag
 * produces needs no filesystem, no child process and no tile tool.
 */
export function datasetInputsFromFlags(
  flags: Readonly<Record<string, string>>,
  workingDirectory: string,
): DatasetInput[] {
  const inputs: DatasetInput[] = [];
  for (const [flag, kind] of Object.entries(INPUT_FLAGS)) {
    const value = flags[flag];
    if (value === undefined || value === 'true') continue;
    const timestamp = flags[`${flag}-timestamp`];
    // The resolved absolute path is used for provisioning only; the recorded provenance
    // name defaults to the file name alone unless the operator supplies one.
    inputs.push({
      kind,
      name: flags[`${flag}-name`] ?? defaultInputName(value),
      path: resolve(workingDirectory, value),
      ...(timestamp === undefined ? {} : { timestamp }),
    });
  }
  return inputs;
}

const USAGE = [
  'atlas-os status',
  'atlas-os doctor',
  'atlas-os update check',
  'atlas-os update list',
  'atlas-os update prepare --source-name <name> --region-extract <path>',
  '                       [--reference-features <path>] [--coastline-polygons <path>]',
  '                       [--lake-centerlines <path>] [--source-timestamp <iso-8601>]',
  'atlas-os update validate <snapshot-id>',
  'atlas-os update activate <snapshot-id> [--activate-while-search-starting]',
  'atlas-os rollback',
] as const;

/** Every command prints one JSON document, so output is machine readable by default. */
export function print(value: JsonObject): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readLocalApi(path: string, baseUrl: string): Promise<unknown> {
  const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`Local API returned HTTP ${response.status}.`);
  return response.json();
}

function exitCodeForError(error: unknown): ExitCode {
  if (!(error instanceof AppError)) return EXIT.failure;
  switch (error.code) {
    case 'CONFIGURATION_INVALID':
      return EXIT.configuration;
    case 'CONFLICT':
      return EXIT.conflict;
    case 'NOT_FOUND':
      return EXIT.notFound;
    case 'BAD_REQUEST':
      return EXIT.usage;
    default:
      return EXIT.failure;
  }
}

function errorOutput(error: unknown): JsonObject {
  if (error instanceof AppError) {
    return { code: error.code, details: error.details, message: error.message, ok: false };
  }
  return { code: 'UNEXPECTED_ERROR', message: String(error), ok: false };
}

async function statusCommand(composition: ApplicationComposition): Promise<CommandResult> {
  const apiOrigin = `http://${composition.config.api.host}:${composition.config.api.port}`;
  try {
    const [health, dataset, capabilities, basemap] = await Promise.all([
      readLocalApi('/health', apiOrigin),
      readLocalApi('/v1/dataset', apiOrigin),
      readLocalApi('/v1/capabilities', apiOrigin),
      readLocalApi('/v1/basemap', apiOrigin),
    ]);
    return { code: EXIT.ok, output: { basemap, capabilities, dataset, health, ok: true } };
  } catch (error) {
    return {
      code: EXIT.failure,
      output: { code: 'LOCAL_API_UNAVAILABLE', message: String(error), ok: false },
    };
  }
}

type Check = DoctorResult['checks'][number];

/** The search check exactly as the local API resolved it, if it is well formed. */
function apiSearchCheck(ready: unknown): Check | undefined {
  const checks = (ready as { checks?: unknown } | null)?.checks;
  if (!Array.isArray(checks)) return undefined;
  const found = checks.find((check) => (check as { name?: unknown }).name === 'search') as
    | { name: unknown; status: unknown; message: unknown }
    | undefined;
  if (
    found === undefined ||
    (found.status !== 'pass' && found.status !== 'warn' && found.status !== 'fail') ||
    typeof found.message !== 'string' ||
    found.message.length > 500
  ) {
    return undefined;
  }
  return { message: found.message, name: 'search', status: found.status };
}

async function doctorCommand(composition: ApplicationComposition): Promise<CommandResult> {
  const apiOrigin = `http://${composition.config.api.host}:${composition.config.api.port}`;
  const local = await composition.service.doctor();
  // Search availability is resolved once, by the serving API that can reach the engine hosts.
  // This process reports that resolution rather than a second, local opinion of its own.
  const withSearch = (search: Check) =>
    local.checks.map((check) => (check.name === 'search' ? search : check));
  try {
    const ready = await readLocalApi('/ready', apiOrigin);
    const search = apiSearchCheck(ready) ?? {
      message: 'The local API did not report a search state.',
      name: 'search',
      status: 'warn' as const,
    };
    return {
      code: local.healthy ? EXIT.ok : EXIT.failure,
      output: { ...local, checks: withSearch(search), localApi: 'reachable', ok: local.healthy },
    };
  } catch (error) {
    return {
      code: EXIT.failure,
      output: {
        ...local,
        checks: withSearch({
          message: 'Search state is reported by the local API, which is unreachable.',
          name: 'search',
          status: 'warn',
        }),
        localApi: 'unreachable',
        message: String(error),
        ok: false,
      },
    };
  }
}

/** The explicitly named override for activating before the standby search engine is ready. */
export const ACTIVATE_WHILE_SEARCH_STARTING = 'activate-while-search-starting';

/**
 * Whether the standby search engine is ready for exactly this snapshot, as the serving API sees
 * it. Activation normally waits for this, so switching the pointer never leaves search starting.
 */
async function searchReadiness(
  composition: ApplicationComposition,
  snapshotId: string,
): Promise<{ readonly ready: true } | { readonly ready: false; readonly details: JsonObject }> {
  const snapshots = await composition.service.listSnapshots();
  const target = snapshots.find((snapshot) => snapshot.snapshotId === snapshotId);
  // Basemap-only snapshots, and unknown ones the platform will refuse anyway, need no engine.
  if (target === undefined || !target.hasSearch) return { ready: true };

  const apiOrigin = `http://${composition.config.api.host}:${composition.config.api.port}`;
  let dataset: unknown;
  try {
    dataset = await readLocalApi('/v1/dataset', apiOrigin);
  } catch {
    return { details: { localApi: 'unreachable' }, ready: false };
  }
  const standby = (dataset as { standby?: unknown } | null)?.standby as
    | { snapshotId?: unknown; search?: { state?: unknown; reason?: unknown } }
    | null
    | undefined;
  if (
    standby?.snapshotId === snapshotId &&
    standby.search?.state === 'ready' &&
    (standby.search as { snapshotId?: unknown }).snapshotId === snapshotId
  ) {
    return { ready: true };
  }
  return {
    details: {
      search:
        standby?.snapshotId === snapshotId && typeof standby.search?.reason === 'string'
          ? standby.search.reason
          : 'not_standby',
    },
    ready: false,
  };
}

/**
 * Dataset administration.
 *
 * These commands compose a provisioning-capable application, which no request-serving process
 * does. Each reports its outcome as JSON and a distinct exit code.
 */
async function updateCommand(
  subcommand: string | undefined,
  positional: readonly string[],
  flags: Readonly<Record<string, string>>,
  environment: Readonly<Record<string, string | undefined>>,
  workingDirectory: string,
): Promise<CommandResult> {
  if (subcommand === undefined) return usageResult();

  let composition: ApplicationComposition;
  try {
    composition =
      subcommand === 'check' || subcommand === 'list'
        ? createApplicationComposition(environment, workingDirectory)
        : await createProvisioningComposition(environment, workingDirectory);
  } catch (error) {
    return { code: exitCodeForError(error), output: errorOutput(error) };
  }

  try {
    if (subcommand === 'check') {
      const result = await composition.service.checkForUpdate();
      return { code: EXIT.ok, output: { ok: true, update: result } };
    }

    if (subcommand === 'list') {
      const snapshots = await composition.service.listSnapshots();
      return { code: EXIT.ok, output: { ok: true, snapshots } };
    }

    if (subcommand === 'prepare') {
      const sourceName = flags['source-name'];
      if (sourceName === undefined || sourceName === 'true') {
        return {
          code: EXIT.usage,
          output: { code: 'USAGE', message: '--source-name is required.', ok: false },
        };
      }
      const inputs = datasetInputsFromFlags(flags, workingDirectory);

      const snapshotId = await composition.service.prepareSnapshot({
        inputs,
        sourceName,
        sourceTimestamp: flags['source-timestamp'],
      });
      return { code: EXIT.ok, output: { ok: true, prepared: snapshotId } };
    }

    const snapshotId = positional[0] ?? flags['snapshot'];
    if (subcommand === 'validate') {
      if (snapshotId === undefined) return usageResult();
      const report = await composition.service.validateSnapshot(snapshotId as never);
      return {
        code: report.valid ? EXIT.ok : EXIT.invalidSnapshot,
        output: { ok: report.valid, report, snapshotId },
      };
    }

    if (subcommand === 'activate') {
      if (snapshotId === undefined) return usageResult();
      const override = flags[ACTIVATE_WHILE_SEARCH_STARTING];
      if (override !== undefined && override !== 'true') return usageResult();
      if (override === undefined) {
        const readiness = await searchReadiness(composition, snapshotId);
        if (!readiness.ready) {
          return {
            code: EXIT.conflict,
            output: {
              code: 'SEARCH_NOT_READY',
              details: { ...readiness.details, override: `--${ACTIVATE_WHILE_SEARCH_STARTING}` },
              message:
                'The search engine for this snapshot is not ready. Retry when it is, or activate ' +
                'anyway and search will report that it is starting until it is.',
              ok: false,
              retryable: true,
            },
          };
        }
      }
      await composition.service.activateSnapshot(snapshotId as never);
      return {
        code: EXIT.ok,
        output: {
          activated: snapshotId,
          ok: true,
          ...(override === undefined ? {} : { searchReadiness: 'not_checked' }),
        },
      };
    }
  } catch (error) {
    if (error instanceof AppError && error.code === 'BAD_REQUEST') {
      return { code: EXIT.invalidSnapshot, output: errorOutput(error) };
    }
    return { code: exitCodeForError(error), output: errorOutput(error) };
  }

  return usageResult();
}

function usageResult(): CommandResult {
  return { code: EXIT.usage, output: { code: 'USAGE', commands: [...USAGE], ok: false } };
}

export async function run(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workingDirectory: string = process.cwd(),
): Promise<ExitCode> {
  const { command, flags, positional } = parseArguments(argv);
  const [verb, subcommand] = command;

  if (verb === 'update') {
    const result = await updateCommand(
      subcommand,
      [...command.slice(2), ...positional],
      flags,
      environment,
      workingDirectory,
    );
    print(result.output);
    return result.code;
  }

  if (verb === 'rollback') {
    try {
      const composition = await createProvisioningComposition(environment, workingDirectory);
      await composition.service.rollbackSnapshot();
      print({ ok: true, rolledBack: true });
      return EXIT.ok;
    } catch (error) {
      print(errorOutput(error));
      return exitCodeForError(error);
    }
  }

  if (verb === 'status' || verb === 'doctor') {
    let composition: ApplicationComposition;
    try {
      composition = createApplicationComposition(environment, workingDirectory);
    } catch (error) {
      print(errorOutput(error));
      return EXIT.configuration;
    }
    const result =
      verb === 'status' ? await statusCommand(composition) : await doctorCommand(composition);
    print(result.output);
    return result.code;
  }

  const result = usageResult();
  print(result.output);
  return result.code;
}
