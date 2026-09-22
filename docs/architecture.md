# Architecture

## Standalone system

`atlas-os` is a new product with no shared history, dependency, compatibility promise, migration
path, or architectural obligation involving another repository named `atlas`. This repository is
the sole source of truth.

## Dependency direction

```text
apps/web ----HTTP----> apps/api --\
apps/api --------------------------\
apps/cli --------------------------- > packages/core -> packages/atlas-os
apps/updater ----------------------/
```

The Web application uses only same-origin HTTP at runtime. The other applications consume core.
Core consumes only the public exports of `@atlas-os/platform`. The platform cannot depend on core
or an app. Provider-specific code, when introduced, remains under `packages/atlas-os` and is never
exported as a public domain type.

The boundary checker evaluates both package manifests and source imports. It rejects direct app to
platform imports, reverse dependencies, cycles, relative escapes, and provider-module imports from
outside the platform package. A negative fixture proves the invalid-app case.

## Public boundaries

`AtlasOs` separates user-facing query operations from `DatasetManager` administrative mutations.
The API exchanges domain values rather than raw upstream HTTP responses. Errors cross the platform
boundary as `PlatformError` and are mapped by core to safe `AppError` values.

The M0 composition uses injected stubs. Applications cannot select individual GIS providers. This
keeps later provider configuration and DTOs inside `packages/atlas-os`.

## Processes

- **gateway** provides one browser origin and routes `/` to Web and `/api/*` to API.
- **web** renders local operational status with React and no remote assets.
- **api** provides liveness, readiness, capability, and dataset endpoints through Fastify.
- **cli** checks the local API and presents typed M0 results.
- **updater** is a separate process with its own health endpoint and update-connectivity state.

The API has request IDs, JSON logs, bounded request and proxy timeouts, safe error responses, and
signal-driven graceful shutdown. The updater also handles termination cleanly.

## Basemap contract

The future pipeline is OSM PBF to generated MVT vector tiles to a PMTiles archive to a browser
renderer. MVT defines each vector tile's encoded content. PMTiles is a single-file archive and
lookup format; it does not make the tiles raster. The public descriptor is a discriminated union:
the unavailable variant contains no consumable resource location, while the ready variant records
the local, versioned archive URL, MVT format, PMTiles media type, bounds, zooms, attribution, and
local style, glyph, and sprite URLs without naming a rendering SDK.

## M0 limits

M0 has no GIS engine, provider adapter, scheduler, downloader, dataset, tile server, public update
endpoint, or snapshot activation. These omissions are represented explicitly as `not_installed`,
`offline`, `not_configured`, or typed `NOT_IMPLEMENTED` results.
