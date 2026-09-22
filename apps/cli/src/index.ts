#!/usr/bin/env node
import { createApplicationComposition } from '@atlas-os/core';

type JsonObject = Readonly<Record<string, unknown>>;

function print(value: JsonObject): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readLocalApi(path: string, baseUrl: string): Promise<unknown> {
  const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) {
    throw new Error(`Local API returned HTTP ${response.status}.`);
  }
  return response.json();
}

export async function run(argv: readonly string[]): Promise<number> {
  let composition;
  try {
    composition = createApplicationComposition();
  } catch (error) {
    print({ code: 'CONFIGURATION_INVALID', message: String(error), ok: false });
    return 1;
  }

  const [command, subcommand] = argv;
  const apiOrigin = `http://${composition.config.api.host}:${composition.config.api.port}`;

  if (command === 'status') {
    try {
      const [health, dataset, capabilities] = await Promise.all([
        readLocalApi('/health', apiOrigin),
        readLocalApi('/v1/dataset', apiOrigin),
        readLocalApi('/v1/capabilities', apiOrigin),
      ]);
      print({ capabilities, dataset, health, ok: true });
      return 0;
    } catch (error) {
      print({ code: 'LOCAL_API_UNAVAILABLE', message: String(error), ok: false });
      return 1;
    }
  }

  if (command === 'doctor') {
    const local = await composition.service.doctor();
    try {
      await readLocalApi('/ready', apiOrigin);
      print({ ...local, localApi: 'reachable' });
      return local.healthy ? 0 : 1;
    } catch (error) {
      print({ ...local, localApi: 'unreachable', message: String(error) });
      return 1;
    }
  }

  const isDeferredCommand =
    (command === 'update' && ['check', 'prepare', 'activate'].includes(subcommand ?? '')) ||
    command === 'rollback';
  if (isDeferredCommand) {
    print({
      code: 'NOT_IMPLEMENTED',
      message: 'Dataset update and rollback commands are not implemented in M0.',
      milestone: 'M0',
      ok: false,
    });
    return 2;
  }

  print({
    code: 'USAGE',
    commands: [
      'atlas-os status',
      'atlas-os doctor',
      'atlas-os update check',
      'atlas-os update prepare',
      'atlas-os update activate',
      'atlas-os rollback',
    ],
    ok: false,
  });
  return 64;
}

process.exitCode = await run(process.argv.slice(2));
