import { createSearchHostComposition, runSearchProbeSelection } from '@atlas-os/core';

/**
 * The private search host for one dataset slot.
 *
 * It runs next to the engine it controls and answers only on the internal network. Its slot and
 * engine configuration are read by the platform from this process's environment. The same image
 * verifies a freshly prepared database during an explicit preparation, with no network at all.
 */
if (process.argv[2] === 'select-probes') {
  try {
    await runSearchProbeSelection();
    process.exit(0);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const details = (error as { details?: unknown }).details;
    process.stderr.write(`${JSON.stringify({ code, details, event: 'probe_selection_failed' })}\n`);
    process.exit(1);
  }
}

const composition = createSearchHostComposition();
const { host } = composition;

function shutdown(signal: string): void {
  process.stdout.write(
    `${JSON.stringify({ event: 'shutdown', service: 'search-host', signal })}\n`,
  );
  host.close().then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({ error: String(error), event: 'shutdown_failed' })}\n`,
      );
      process.exit(1);
    },
  );
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => shutdown(signal));
}

const address = await host.start();
process.stdout.write(
  `${JSON.stringify({ event: 'started', port: address.port, service: 'search-host' })}\n`,
);
