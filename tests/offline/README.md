# Offline smoke test

`pnpm test:offline` runs `scripts/offline-smoke.mjs`. It provisions a fixture snapshot on the host
with the command-line tool, starts only prebuilt Compose images with that snapshot mounted
read-only on the internal runtime network, and verifies through the loopback gateway:

- the gateway responds and the Web application loads;
- the API is healthy and ready;
- the dataset and basemap both report a ready state for the provisioned snapshot;
- a byte-range read of the archive returns `206` with a correct content range and the archive
  header, and an unsatisfiable range returns `416`;
- the local style, glyph and sprite resources are served, and the style references nothing
  outside the deployment;
- a percent-encoded traversal attempt is refused;
- the right-to-left text plugin is served from this origin;
- the updater reports an offline state without becoming unhealthy.

Compose status and per-service logs are collected on failure, and the test stack is removed
afterwards. See `docs/development.md` for provisioning and execution steps.
