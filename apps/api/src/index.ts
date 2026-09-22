import { createApplicationComposition } from '@atlas-os/core';

import { buildApiServer } from './server.js';

const composition = createApplicationComposition();
const server = buildApiServer(composition);

async function shutdown(signal: string): Promise<void> {
  server.log.info({ signal }, 'Graceful shutdown requested');
  await server.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(
      () => process.exit(0),
      (error: unknown) => {
        server.log.error({ error, signal }, 'Graceful shutdown failed');
        process.exit(1);
      },
    );
  });
}

await server.listen({ host: composition.config.api.host, port: composition.config.api.port });
