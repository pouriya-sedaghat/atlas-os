import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { z } from 'zod';

import type { GeographicBounds } from '../../contracts.js';
import type { SearchProbe } from '../../snapshot.js';
import type { ProbeCandidate } from './dump/postprocess.js';
import type { ExpectedTree } from './host/copy.js';
import { copySealedTree, resetWorkRoot } from './host/copy.js';
import type { EngineCommandFactory } from './host/engine.js';
import { EngineProcess } from './host/engine.js';
import { awaitEngine, selectProbes, verifyCanary } from './host/verify.js';

/** Everything probe selection needs, as one self-contained, path-free request. */
export const probeSelectionRequestSchema = z
  .object({
    bounds: z
      .object({ east: z.number(), north: z.number(), south: z.number(), west: z.number() })
      .strict(),
    candidates: z
      .array(
        z.discriminatedUnion('type', [
          z
            .object({
              expectId: z.string(),
              importance: z.number(),
              language: z.enum(['fa', 'en']),
              query: z.string(),
              type: z.literal('search'),
            })
            .strict(),
          z
            .object({
              coordinate: z.object({ latitude: z.number(), longitude: z.number() }).strict(),
              expectId: z.string(),
              importance: z.number(),
              language: z.enum(['fa', 'en']),
              type: z.literal('reverse'),
            })
            .strict(),
        ]),
      )
      .max(64),
    canary: z.object({ latitude: z.number(), longitude: z.number() }).strict(),
    expected: z
      .object({
        bytes: z.number().int().nonnegative(),
        directories: z.number().int().nonnegative(),
        files: z.number().int().nonnegative(),
        treeDigest: z.string(),
      })
      .strict(),
    importDate: z.string(),
    marker: z.string(),
  })
  .strict();

export type ProbeSelectionRequest = z.infer<typeof probeSelectionRequestSchema>;

export async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/**
 * Starts the freshly sealed database on a disposable working copy, proves it holds this
 * generation, and chooses the probes the snapshot records from the candidates it answers.
 *
 * The same copy, start, canary and probe code the engine host runs on every load, so a probe is
 * recorded only if the host will be able to answer it the same way.
 */
export async function selectProbesWithEngine(options: {
  readonly sealedEngine: string;
  readonly workRoot: string;
  readonly engineCommand: EngineCommandFactory;
  readonly request: {
    readonly bounds: GeographicBounds;
    readonly candidates: readonly ProbeCandidate[];
    readonly canary: { readonly latitude: number; readonly longitude: number };
    readonly expected: ExpectedTree;
    readonly importDate: string;
    readonly marker: string;
  };
  readonly startupTimeoutMs?: number;
  readonly port?: number;
}): Promise<SearchProbe[]> {
  await resetWorkRoot(options.workRoot);
  const copy = await copySealedTree({
    expected: options.request.expected,
    name: randomUUID(),
    reserveBytes: 0,
    source: options.sealedEngine,
    workRoot: options.workRoot,
  });
  const port = options.port ?? (await freeLoopbackPort());
  const temporaryDirectory = join(options.workRoot, 'tmp');
  const engine = EngineProcess.start({
    command: options.engineCommand({
      dataDirectory: copy.path,
      homeDirectory: join(options.workRoot, 'home'),
      port,
      temporaryDirectory,
    }),
    home: join(options.workRoot, 'home'),
    path: process.env['PATH'],
    port,
    temporaryDirectory,
  });
  try {
    await awaitEngine(engine, options.request.importDate, options.startupTimeoutMs ?? 300_000);
    await verifyCanary(engine, options.request.canary, options.request.marker, 10_000);
    return await selectProbes(engine, options.request.candidates, options.request.bounds, 10_000);
  } finally {
    await engine.stop();
    await rm(options.workRoot, { force: true, recursive: true });
  }
}
