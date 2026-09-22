import { createServer, type Server } from 'node:http';

import type { ApplicationComposition } from '@atlas-os/core';

export interface UpdaterHealth {
  readonly ready: true;
  readonly service: 'updater';
  readonly status: 'ok';
  readonly updateConnectivity: 'offline' | 'not_configured';
}

export function updaterHealth(composition: ApplicationComposition): UpdaterHealth {
  return {
    ready: true,
    service: 'updater',
    status: 'ok',
    updateConnectivity: composition.config.offline ? 'offline' : 'not_configured',
  };
}

export function buildUpdaterServer(composition: ApplicationComposition): Server {
  return createServer((request, response) => {
    if (request.method === 'GET' && (request.url === '/health' || request.url === '/ready')) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(updaterHealth(composition)));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
  });
}
