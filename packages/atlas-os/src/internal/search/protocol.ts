import { z } from 'zod';

import { slotSchema } from '../../snapshot.js';

/**
 * The private protocol between the API and a per-slot search engine host.
 *
 * It is not a public contract: it travels only on the internal runtime network, and nothing in it
 * names the engine behind the host. Every successful answer carries the exact load identity that
 * produced it, so the API can prove which generation answered.
 */
export const HOST_HEADERS = {
  generation: 'x-atlas-generation',
  loadId: 'x-atlas-load-id',
  snapshotId: 'x-atlas-snapshot',
} as const;

export const HOST_ROUTES = {
  reverse: '/v1/reverse',
  search: '/v1/search',
  status: '/v1/status',
} as const;

export const hostStateSchema = z.enum(['idle', 'loading', 'ready', 'failed', 'insufficient_space']);
export type HostState = z.infer<typeof hostStateSchema>;

export const hostLoadSchema = z
  .object({
    engineImportDate: z.string().max(64),
    generationMarker: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    loadId: z.string().uuid(),
    slot: slotSchema,
    snapshotId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
  })
  .strict();
export type HostLoad = z.infer<typeof hostLoadSchema>;

const diagnosticsSchema = z
  .object({
    copyMethod: z.enum(['clone', 'copy']).nullable(),
    copyMilliseconds: z.number().nonnegative().nullable(),
    heapLimit: z.string().max(16).nullable(),
    /** Why the engine last stopped without being asked to, if it ever has. */
    lastEngineExit: z.enum(['memory_limit', 'pids_limit', 'heap_exhausted', 'exited']).nullable(),
    /** The container's hard limits, where the kernel reports them; null means none is visible. */
    memoryLimitBytes: z.number().int().positive().nullable(),
    pidsLimit: z.number().int().positive().nullable(),
    residentBytes: z.number().int().nonnegative().nullable(),
    residentPeakBytes: z.number().int().nonnegative().nullable(),
    startupMilliseconds: z.number().nonnegative().nullable(),
    treeBytes: z.number().int().nonnegative().nullable(),
    verifyMilliseconds: z.number().nonnegative().nullable(),
  })
  .strict();
export type HostDiagnostics = z.infer<typeof diagnosticsSchema>;

/**
 * What the host reports about itself.
 *
 * `load` is the generation currently answering, if any. `pending` describes a load in progress or
 * the last failed attempt, so an operator can see why a new generation is not serving yet without
 * the host ever exposing a path.
 */
export const hostStatusSchema = z
  .object({
    diagnostics: diagnosticsSchema,
    load: hostLoadSchema.nullable(),
    pending: z
      .object({
        snapshotId: z.string().max(64).nullable(),
        state: z.enum(['loading', 'failed', 'insufficient_space']),
      })
      .strict()
      .nullable(),
    slot: slotSchema,
    state: hostStateSchema,
  })
  .strict();
export type HostStatus = z.infer<typeof hostStatusSchema>;

/** Private query parameters a host accepts; everything else is refused. */
export const HOST_SEARCH_PARAMETERS = ['q', 'lang', 'limit', 'lat', 'lon', 'bbox'] as const;
export const HOST_REVERSE_PARAMETERS = ['lat', 'lon', 'lang', 'limit'] as const;

/** Upper bound on any response body a host or the API will read. */
export const MAX_ENGINE_RESPONSE_BYTES = 1024 * 1024;
