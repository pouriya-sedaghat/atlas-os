import { createApplicationComposition } from '@atlas-os/core';

import { buildUpdaterServer, updaterHealth } from './server.js';

const composition = createApplicationComposition();
const server = buildUpdaterServer(composition);

function shutdown(signal: string): void {
  process.stdout.write(`${JSON.stringify({ event: 'shutdown', service: 'updater', signal })}\n`);
  server.close((error) => {
    if (error) {
      process.stderr.write(
        `${JSON.stringify({ error: String(error), event: 'shutdown_failed' })}\n`,
      );
      process.exit(1);
    }
    process.exit(0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => shutdown(signal));
}

server.listen(composition.config.updater.port, composition.config.updater.host, () => {
  process.stdout.write(
    `${JSON.stringify({
      event: 'started',
      host: composition.config.updater.host,
      port: composition.config.updater.port,
      service: 'updater',
      updateConnectivity: updaterHealth(composition).updateConnectivity,
    })}\n`,
  );
});
