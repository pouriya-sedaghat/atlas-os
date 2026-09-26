import {
  AppError,
  type ApplicationComposition,
  type PlaceQueryOutcome,
  type SearchParameters,
} from '@atlas-os/core';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

export interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

export function resolveLoggerConfiguration(
  logLevel: ApplicationComposition['config']['logLevel'],
  override?: boolean,
): false | { readonly level: ApplicationComposition['config']['logLevel'] } {
  return override === false ? false : { level: logLevel };
}

/** Route prefix under which versioned basemap resources are served. */
export const RESOURCE_PREFIX = '/maps';

function errorBody(code: string, message: string, requestId: string): ErrorResponse {
  return { error: { code, message, requestId } };
}

/**
 * Serves one basemap resource.
 *
 * The platform returns an outcome rather than throwing for expected conditions, so this handler
 * is a total mapping from outcome to status code with no error-message inspection.
 */
async function serveResource(
  composition: ApplicationComposition,
  request: FastifyRequest<{ Params: { '*': string } }>,
  reply: FastifyReply,
): Promise<void> {
  const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
  const result = await composition.service.basemapResource({
    method,
    path: request.params['*'],
    rangeHeader: request.headers.range,
  });

  if (result.outcome === 'invalid_request') {
    await reply.code(400).send(errorBody('BAD_REQUEST', result.reason, request.id));
    return;
  }
  if (result.outcome === 'not_found') {
    await reply.code(404).send(errorBody('NOT_FOUND', 'Resource not found.', request.id));
    return;
  }
  if (result.outcome === 'unavailable') {
    await reply
      .code(503)
      .send(errorBody('FEATURE_UNAVAILABLE', 'No dataset is installed.', request.id));
    return;
  }
  if (result.outcome === 'range_not_satisfiable') {
    await reply
      .code(416)
      .header('accept-ranges', 'bytes')
      .header('content-range', result.contentRange)
      .send(errorBody('RANGE_NOT_SATISFIABLE', 'Requested range cannot be satisfied.', request.id));
    return;
  }

  reply
    .code(result.status)
    .header('accept-ranges', result.headers.acceptRanges)
    .header('cache-control', result.headers.cacheControl)
    .header('content-length', result.headers.contentLength)
    .header('content-type', result.headers.contentType);
  if (result.headers.contentRange !== undefined) {
    reply.header('content-range', result.headers.contentRange);
  }

  if (result.body === null) {
    // A HEAD response carries the headers of the equivalent GET but no body. Fastify would
    // otherwise recompute content-length from an empty payload.
    await reply.send();
    return;
  }
  await reply.send(result.body);
}

/**
 * Every query parameter exactly as sent, values in order. Read from the raw request line rather
 * than a parsed query object, so a duplicated parameter can never be silently merged or dropped.
 */
export function rawQueryParameters(url: string | undefined): SearchParameters {
  const query = new URL(url ?? '/', 'http://api.invalid').searchParams;
  const parameters: Record<string, string[]> = {};
  for (const [key, value] of query) (parameters[key] ??= []).push(value);
  return parameters;
}

/**
 * Maps a place query outcome onto HTTP. Total: every outcome has exactly one response, and none
 * carries anything the engine said.
 */
async function sendPlaceOutcome(
  outcome: PlaceQueryOutcome,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.header('cache-control', 'no-store');
  switch (outcome.outcome) {
    case 'ok':
      await reply.code(200).send({
        attribution: outcome.attribution,
        requestId: request.id,
        results: outcome.results,
        snapshotId: outcome.snapshotId,
      });
      return;
    case 'invalid_request':
      await reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          details: { field: outcome.field, reason: outcome.reason },
          message: 'The request parameters are invalid.',
          requestId: request.id,
        },
      });
      return;
    case 'unavailable':
      if (outcome.retryAfterSeconds !== null) {
        reply.header('retry-after', String(outcome.retryAfterSeconds));
      }
      await reply.code(503).send({
        error: {
          code: 'FEATURE_UNAVAILABLE',
          details: { reason: outcome.reason, retryable: outcome.retryable },
          message: 'Search is unavailable.',
          requestId: request.id,
        },
      });
      return;
    case 'upstream_failed':
      await reply
        .code(502)
        .send(
          errorBody(
            'UPSTREAM_FAILED',
            'The search service returned an unusable answer.',
            request.id,
          ),
        );
      return;
  }
}

export function buildApiServer(
  composition: ApplicationComposition,
  options: { readonly logger?: boolean } = {},
): FastifyInstance {
  const server = Fastify({
    bodyLimit: 65_536,
    connectionTimeout: 5_000,
    keepAliveTimeout: 5_000,
    logger: resolveLoggerConfiguration(composition.config.logLevel, options.logger),
    requestTimeout: 10_000,
  });

  server.get('/health', async (request) => ({
    requestId: request.id,
    service: 'api',
    status: 'ok',
  }));

  server.get('/ready', async (request) => ({
    ...(await composition.service.readiness()),
    requestId: request.id,
  }));

  server.get('/v1/capabilities', async (request) => ({
    ...(await composition.service.capabilities()),
    requestId: request.id,
  }));

  server.get('/v1/dataset', async (request) => ({
    ...(await composition.service.datasetStatus()),
    requestId: request.id,
  }));

  server.get('/v1/basemap', async (request) => ({
    ...(await composition.service.basemap()),
    requestId: request.id,
  }));

  // Read-only place queries. Parameters are validated strictly by the platform; there is no
  // mutation route of any kind here.
  server.get('/v1/search', async (request, reply) => {
    await sendPlaceOutcome(
      await composition.service.searchPlaces(rawQueryParameters(request.raw.url)),
      request,
      reply,
    );
  });

  server.get('/v1/reverse', async (request, reply) => {
    await sendPlaceOutcome(
      await composition.service.reverseGeocode(rawQueryParameters(request.raw.url)),
      request,
      reply,
    );
  });

  // Dataset administration is deliberately absent: there is no HTTP route that prepares,
  // activates or rolls back a snapshot, and this process is composed without provisioning.
  server.route({
    handler: async (request, reply) => {
      await serveResource(
        composition,
        request as FastifyRequest<{ Params: { '*': string } }>,
        reply,
      );
    },
    method: ['GET', 'HEAD'],
    url: `${RESOURCE_PREFIX}/*`,
  });

  server.setNotFoundHandler(async (request, reply) => {
    await reply.code(404).send(errorBody('NOT_FOUND', 'Route not found.', request.id));
  });

  server.setErrorHandler(async (error, request, reply) => {
    request.log.error({ error, requestId: request.id }, 'Request failed');
    const appError =
      error instanceof AppError
        ? error
        : new AppError('INTERNAL_ERROR', 'An unexpected internal error occurred.', {
            cause: error,
            statusCode: 500,
          });
    await reply
      .code(appError.statusCode)
      .send(errorBody(appError.code, appError.message, request.id));
  });

  return server;
}
