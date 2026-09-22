# atlas-os

`atlas-os` is a standalone, self-hosted, offline-first geospatial demonstration platform. This
repository is not related to, derived from, or compatible with any other project named `atlas`.

Milestone M0 establishes the repository and architecture foundation. It deliberately contains no
map data and does not yet provide maps, search, geocoding, routing, matrix calculations,
isochrones, or map matching.

## Architecture

Local workspace dependencies flow in one direction:

```text
apps -> @atlas-os/core -> @atlas-os/platform
```

- `packages/atlas-os` is the provider-neutral platform façade and owns future provider selection.
- `packages/core` validates configuration, composes the platform, maps errors, and exposes use
  cases.
- `apps/*` depend on core or communicate with the local API; they never assemble GIS providers.

`pnpm test:boundaries` enforces this direction, detects cycles and reverse dependencies, and keeps
future provider modules private to the platform package.

## Quick start

Prerequisites are Node.js 22.14 or later and pnpm 10.17.1.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @atlas-os/api start
```

In another terminal:

```sh
pnpm --filter @atlas-os/web dev
```

The development Web server proxies `/api` to the local API. Copy `.env.example` to `.env` only if
you need local overrides; no secrets are required.

## Local endpoints

- `GET /health`: API process liveness.
- `GET /ready`: composition readiness.
- `GET /v1/capabilities`: provider-neutral capability states.
- `GET /v1/dataset`: current stub dataset state.

The gateway exposes those routes under `/api/*` and the Web application at `/`.

## Commands

```text
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:offline
pnpm test:boundaries
pnpm test:container
pnpm build
pnpm compose:config
pnpm images:inspect
pnpm check
```

`pnpm check` is the complete M0 pre-commit gate, including Compose configuration validation.
Docker-dependent verification requires Docker Compose. See [development](docs/development.md).

## Basemap direction

V1 will contain Mapbox Vector Tile (MVT) data in a PMTiles archive. MVT is the vector tile encoding;
PMTiles is the archive and access format that contains those tiles. No raster basemap is planned
for V1. M0 defines only a renderer-neutral descriptor and reports the basemap as unavailable; it
does not expose snapshot IDs or resource locations, and there is no tile serving or rendering.

## Governance

No project-level open-source license has been selected. Licensing is a pending owner decision; do
not assume permission beyond applicable law and repository access controls. Data provenance will
be recorded using [DATA_SOURCES.md](DATA_SOURCES.md) when a dataset is approved in a later
milestone.

## Documentation

- [Architecture](docs/architecture.md)
- [Offline-first behavior](docs/offline-first.md)
- [Data lifecycle](docs/data-lifecycle.md)
- [Development and configuration](docs/development.md)
- [Supply-chain controls](docs/supply-chain.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
