import { AppError, type ApplicationComposition } from '@atlas-os/core';
import Fastify, { type FastifyInstance } from 'fastify';

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

  server.setNotFoundHandler(async (request, reply) => {
    const response: ErrorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
        requestId: request.id,
      },
    };
    await reply.code(404).send(response);
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
    const response: ErrorResponse = {
      error: {
        code: appError.code,
        message: appError.message,
        requestId: request.id,
      },
    };
    await reply.code(appError.statusCode).send(response);
  });

  return server;
}
