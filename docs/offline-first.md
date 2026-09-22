# Offline-first runtime

Normal user requests must be served by local processes and local data. Internet access is reserved
for an explicitly configured future updater; it is never a readiness dependency for the Web app,
API, or future query services.

In M0:

- the Web bundle contains no CDN, hosted font, analytics, or telemetry URL;
- the gateway has no public upstream;
- the API and updater make no scheduled or startup network request;
- the updater reports `offline` when `ATLAS_OFFLINE=true` and remains healthy;
- Compose uses an internal bridge network, so provisioned containers have local connectivity but
  no external route;
- package and image downloads are provisioning activities, not runtime behavior.

## Reproducible smoke test

Provision while registries are available:

```sh
pnpm install --frozen-lockfile
pnpm compose:build
```

Then run:

```sh
pnpm test:offline
```

The script uses `docker compose up --no-build --wait` on the internal-only network, verifies the
gateway, Web document, API health, and dataset endpoint, and relies on Compose health checks to
verify the updater's non-fatal offline state. It removes only its dedicated test project afterward.

Internet absence is an update condition, not a runtime incident. A future update attempt may be
deferred or retried while the active snapshot continues serving requests.
