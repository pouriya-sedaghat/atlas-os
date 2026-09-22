import { resolve } from 'node:path';

import {
  AppError,
  createApplicationComposition,
  createProvisioningComposition,
  type ApplicationComposition,
  type DatasetInput,
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

const USAGE = [
  'atlas-os status',
  'atlas-os doctor',
  'atlas-os update check',
  'atlas-os update list',
  'atlas-os update prepare --source-name <name> --region-extract <path>',
  '                       [--reference-features <path>] [--coastline-polygons <path>]',
  '                       [--lake-centerlines <path>] [--source-timestamp <iso-8601>]',
  'atlas-os update validate <snapshot-id>',
  'atlas-os update activate <snapshot-id>',
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

async function doctorCommand(composition: ApplicationComposition): Promise<CommandResult> {
  const apiOrigin = `http://${composition.config.api.host}:${composition.config.api.port}`;
  const local = await composition.service.doctor();
  try {
    await readLocalApi('/ready', apiOrigin);
    return {
      code: local.healthy ? EXIT.ok : EXIT.failure,
      output: { ...local, localApi: 'reachable', ok: local.healthy },
    };
  } catch (error) {
    return {
      code: EXIT.failure,
      output: { ...local, localApi: 'unreachable', message: String(error), ok: false },
    };
  }
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
      await composition.service.activateSnapshot(snapshotId as never);
      return { code: EXIT.ok, output: { activated: snapshotId, ok: true } };
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
