import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import type { GeographicBounds } from '../../../contracts.js';
import type { SearchProbe } from '../../../snapshot.js';
import type { ProbeCandidate } from '../dump/postprocess.js';
import type { EngineCollection } from '../mapping.js';
import {
  CANARY_OBJECT_ID,
  CANARY_OBJECT_TYPE,
  GENERATION_KEY,
  engineCollectionSchema,
} from '../mapping.js';
import { probeRequest, probeSatisfied } from '../queries.js';
import type { EngineCallResult, EngineProcess } from './engine.js';

/** Why an engine was not accepted. Reported as a neutral code, never as engine output. */
export class LoadFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const engineStatusSchema = z
  .object({ import_date: z.string().max(64), status: z.literal('Ok') })
  .passthrough();

/** Same instant: the engine prints import instants without a zero millisecond part. */
export function sameInstant(left: string, right: string): boolean {
  const a = Date.parse(left);
  const b = Date.parse(right);
  return !Number.isNaN(a) && a === b;
}

export type HostRoute = 'search' | 'reverse';

/** The engine request for a validated host request. Bias settings are fixed, not caller-chosen. */
export function engineQuery(
  route: HostRoute,
  parameters: Readonly<Record<string, string>>,
): { readonly path: string; readonly parameters: Record<string, string> } {
  if (route === 'reverse') {
    return {
      parameters: {
        lang: parameters['lang']!,
        lat: parameters['lat']!,
        limit: parameters['limit']!,
        lon: parameters['lon']!,
      },
      path: '/reverse',
    };
  }
  const query: Record<string, string> = {
    dedupe: 'false',
    lang: parameters['lang']!,
    limit: parameters['limit']!,
    q: parameters['q']!,
  };
  if (parameters['bbox'] !== undefined) query['bbox'] = parameters['bbox'];
  if (parameters['lat'] !== undefined) {
    query['lat'] = parameters['lat'];
    query['lon'] = parameters['lon']!;
    query['zoom'] = '12';
    query['location_bias_scale'] = '0.4';
  }
  return { parameters: query, path: '/api' };
}

export function parseCollection(result: EngineCallResult): EngineCollection | undefined {
  if (result.kind !== 'response' || result.response.status !== 200) return undefined;
  try {
    const parsed = engineCollectionSchema.safeParse(
      JSON.parse(result.response.body.toString('utf8')),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Waits until the engine answers its status route, and proves it reports the import instant
 * this generation was built with; anything else means it is not the database described.
 */
export async function awaitEngine(
  engine: EngineProcess,
  importDate: string,
  timeoutMs: number,
  cancelled: () => boolean = () => false,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cancelled()) throw new LoadFailure('cancelled');
    if (engine.hasExited) throw new LoadFailure('engine_exited');
    const result = await engine.get('/status', {}, 1_000);
    if (result.kind === 'response' && result.response.status === 200) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.response.body.toString('utf8'));
      } catch {
        throw new LoadFailure('engine_status_invalid');
      }
      const status = engineStatusSchema.safeParse(parsed);
      if (!status.success) throw new LoadFailure('engine_status_invalid');
      if (!sameInstant(status.data.import_date, importDate)) {
        throw new LoadFailure('import_date_mismatch');
      }
      return;
    }
    await delay(200);
  }
  throw new LoadFailure('engine_start_timeout');
}

async function ask(
  engine: EngineProcess,
  probe: SearchProbe,
  bounds: GeographicBounds,
  timeoutMs: number,
): Promise<boolean> {
  const request = probeRequest(probe, bounds);
  const query = engineQuery(request.route, request.parameters);
  const answer = parseCollection(await engine.get(query.path, query.parameters, timeoutMs));
  return answer !== undefined && probeSatisfied(probe, answer, bounds);
}

/** The canary proves which generation the engine holds, by the full marker it carries. */
export async function verifyCanary(
  engine: EngineProcess,
  canary: { readonly latitude: number; readonly longitude: number },
  marker: string,
  timeoutMs: number,
): Promise<void> {
  const answer = parseCollection(
    await engine.get(
      '/reverse',
      { lat: String(canary.latitude), limit: '1', lon: String(canary.longitude) },
      timeoutMs,
    ),
  );
  const feature = answer?.features[0];
  if (
    feature === undefined ||
    feature.properties.osm_type !== CANARY_OBJECT_TYPE ||
    feature.properties.osm_id !== CANARY_OBJECT_ID ||
    feature.properties.extra?.[GENERATION_KEY] !== marker
  ) {
    throw new LoadFailure('canary_mismatch');
  }
}

/** Every recorded probe must be answered exactly as it was when the snapshot was built. */
export async function verifyProbes(
  engine: EngineProcess,
  probes: readonly SearchProbe[],
  bounds: GeographicBounds,
  timeoutMs: number,
): Promise<void> {
  for (const probe of probes) {
    if (!(await ask(engine, probe, bounds, timeoutMs))) throw new LoadFailure('probe_failed');
  }
}

/** How many probes of each kind a snapshot records, at most. */
export const PROBE_QUOTA = { en: 1, fa: 3, reverse: 2 } as const;

/**
 * Chooses the probes a snapshot records: the best candidates the freshly imported engine actually
 * answers, asked exactly as a person's query would be. Deterministic for the same data.
 */
export async function selectProbes(
  engine: EngineProcess,
  candidates: readonly ProbeCandidate[],
  bounds: GeographicBounds,
  timeoutMs: number,
): Promise<SearchProbe[]> {
  const selected: SearchProbe[] = [];
  const used = { en: 0, fa: 0, reverse: 0 };
  for (const candidate of candidates) {
    const slot = candidate.type === 'reverse' ? 'reverse' : candidate.language;
    if (used[slot] >= PROBE_QUOTA[slot]) continue;
    const probe: SearchProbe =
      candidate.type === 'search'
        ? {
            expectId: candidate.expectId,
            language: candidate.language,
            query: candidate.query,
            type: 'search',
          }
        : {
            coordinate: candidate.coordinate,
            expectId: candidate.expectId,
            language: candidate.language,
            type: 'reverse',
          };
    if (await ask(engine, probe, bounds, timeoutMs)) {
      selected.push(probe);
      used[slot] += 1;
    }
  }
  if (selected.length === 0) throw new LoadFailure('no_probe_answered');
  return selected;
}
