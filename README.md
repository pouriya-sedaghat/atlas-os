# atlas-os

`atlas-os` is a standalone, self-hosted, offline-first geospatial platform. This repository is not
related to, derived from, or compatible with any other project named `atlas`.

Milestone **M1** adds an end-to-end vector basemap: operator-supplied OpenStreetMap and reference
data are turned into a PMTiles archive of vector tiles, validated against the archive's own
metadata, activated atomically, and served from the same origin as the Web application, which
renders it with local styles, glyphs and sprites in Persian and English. No dataset is included in
this repository, and nothing is downloaded at runtime.

Milestone **M2** adds offline search and reverse geocoding in Persian and English, built from the
same operator-supplied OpenStreetMap extract as the basemap and served by one private search host
per snapshot slot, behind a guard that never answers from a stale dataset. The Web application has
an accessible Persian place search and an explicit "describe this point" action.

Routing, matrix calculations, isochrones and map matching are still not implemented and report
themselves as not installed.

## Architecture

Local workspace dependencies flow in one direction:

```text
apps -> @atlas-os/core -> @atlas-os/platform
```

- `packages/atlas-os` is the provider-neutral platform façade. Tile generation, archive writing,
  glyph rasterisation, snapshot storage and resource serving live under its private `internal/`
  tree.
- `packages/core` validates configuration, composes the platform, maps errors, and exposes
  application use cases.
- `apps/*` depend on core or talk to the local API; they never assemble geospatial providers.

`pnpm test:boundaries` enforces this direction, detects cycles and reverse dependencies, and keeps
the platform's private modules unreachable from outside the package.

## Quick start

Prerequisites are Node.js 22.14 or later and pnpm 10.17.1.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm basemap:fixture
pnpm api:start:fixture
```

`pnpm basemap:fixture` provisions a small synthetic basemap with no download, and
`pnpm api:start:fixture` starts the API against it. These commands contain no shell-specific
syntax, so they run as written in PowerShell, Command Prompt and POSIX shells.

In another terminal:

```sh
pnpm --filter @atlas-os/web dev
```

The development server proxies `/api` and `/maps` to the local API, so the browser sees one
origin. Without the fixture step the application still starts and reports that no basemap is
installed.

For search in the fixture too, build the local images and prepare the dataset fixture instead of
the basemap fixture (the real engine runs in a Linux container):

```sh
pnpm compose:build
pnpm dataset:fixture
```

For a real dataset, see [provisioning a basemap](docs/development.md#provisioning-a-basemap).

## Local endpoints

- `GET /health` — API process liveness.
- `GET /ready` — composition readiness.
- `GET /v1/capabilities` — provider-neutral capability states.
- `GET /v1/dataset` — current dataset state.
- `GET /v1/basemap` — basemap descriptor, or a truthful unavailable state.
- `GET|HEAD /maps/v1/{snapshotId}/…` — versioned basemap resources with byte-range support.
- `GET /v1/search?q&limit&language&lat&lon` — place search; `language` is `fa` (default) or `en`.
- `GET /v1/reverse?lat&lon&language` — the place at a point, if any.

The gateway exposes these under `/api/*` and `/maps/*`, and the Web application at `/`. No HTTP
endpoint mutates a dataset; provisioning is a command-line operation.

## Commands

```text
pnpm format            pnpm test:unit            pnpm build
pnpm format:check      pnpm test:contract        pnpm compose:config
pnpm lint              pnpm test:integration     pnpm compose:build
pnpm typecheck         pnpm test:provisioning    pnpm images:inspect
pnpm test              pnpm test:boundaries      pnpm test:offline
pnpm basemap:fixture   pnpm test:container       pnpm test:e2e
pnpm dataset:fixture   pnpm test:engine          pnpm api:start:fixture
pnpm check             pnpm verify               pnpm test:engine:jar
```

`pnpm check` is the complete gate that needs no browser and no Docker daemon. `pnpm verify` adds
the browser end-to-end suite. Docker-dependent verification requires Docker Compose. See
[development](docs/development.md).

## Basemap

The basemap is Mapbox Vector Tile (MVT) data stored in a PMTiles archive. MVT is the encoding of
each tile; PMTiles is the single-file archive and addressing format that contains those tiles and
allows a client to fetch exactly the bytes it needs. No raster basemap is planned.

Resources are addressed by immutable, snapshot-versioned URLs and may be cached indefinitely;
activating a new snapshot mints new URLs rather than changing existing bytes, and a URL that can
no longer be served truthfully returns nothing rather than another snapshot's bytes. The
descriptor distinguishes "nothing installed" from "installed but unusable", and neither state
exposes a URL or snapshot identifier.

A production basemap requires more than the OpenStreetMap extract — its low-zoom layers also read
reference geometry and coastline polygons — and a preparation missing a required input is refused
rather than producing an incomplete basemap. See
[provisioning a basemap](docs/development.md#provisioning-a-basemap).

## Search

Search is built from the raw regional extract alone — the same file, checked by digest, that the
basemap is built from. Persian spelling variants (Arabic kaf and yeh, Persian and Arabic-Indic
digits, diacritics, invisible marks) are matched by indexing canonical search-only variants and
canonicalising every query the same way, while results show names and house numbers exactly as
mapped. Search answers carry OpenStreetMap attribution under the ODbL, shown separately from the
basemap's. Quality and resources at the scale of a whole country have not been measured yet; see
[DATA_SOURCES.md](DATA_SOURCES.md) and the [architecture decision](docs/adr/0001-offline-search.md).

## Governance

No project-level open-source license has been selected. Licensing is a pending owner decision; do
not assume permission beyond applicable law and repository access controls. Third-party components
carry their own licences, recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Dataset
provenance is recorded in [DATA_SOURCES.md](DATA_SOURCES.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Offline-first behavior](docs/offline-first.md)
- [Data lifecycle](docs/data-lifecycle.md)
- [Development and configuration](docs/development.md)
- [Supply-chain controls](docs/supply-chain.md)
- [ADR 0001: offline search](docs/adr/0001-offline-search.md)
- [Data sources](DATA_SOURCES.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
