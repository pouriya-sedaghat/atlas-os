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

The Web application uses only same-origin HTTP at runtime; it imports contract _types_ from core
so the boundary holds for types as well as behaviour, and it never imports the platform package.
Core consumes only the public exports of `@atlas-os/platform`. The platform cannot depend on core
or an app. Provider-specific code lives under `packages/atlas-os/src/internal/` and is never
exported as a public domain type.

`pnpm test:boundaries` evaluates both package manifests and source imports. It rejects direct app
to platform imports, reverse dependencies, cycles, relative escapes, and any import of the
platform's private `internal/` tree from outside the platform package. Negative fixtures prove
each rejected case.

## Public boundaries

`AtlasOs` separates user-facing query operations from `DatasetManager` administrative mutations,
and `BasemapResourceReader` serves the versioned files behind an active basemap. The API exchanges
domain values rather than raw upstream responses. Errors cross the platform boundary as
`PlatformError` and are mapped by core to safe `AppError` values with HTTP status codes.

Provider selection happens in one place, `createPlatform`. Neither core nor any application names
a tile tool, a tile schema or a rendering SDK.

### Provider selection lives in the platform

`createPlatform` takes neutral provisioning intent — region bounds, label languages, the font
glyphs are generated from — and the raw environment, which it passes to nothing and reads itself.
Which tile tool exists, which implementation is selected and how it is executed are decided inside
`packages/atlas-os` alone. Core contains no tool identifier, no builder selector and no execution
mode, and no command-line flag selects a provider; a boundary test fails the build if any of those
appear in core or an application.

### Provisioning is a separate composition

`createApplicationComposition` builds a request-serving application and supplies **no**
provisioning options. The resulting platform is structurally unable to prepare, activate or roll
back a dataset: `LocalDatasetManager` has no provisioner to delegate to and refuses with a typed
error. `createProvisioningComposition` is used only by the command-line tool.

This is stronger than omitting an HTTP route. There is also no such route: nothing under
`/v1/*` mutates a dataset, and an integration test asserts that every plausible mutation verb and
path is refused.

## M1 data flow

```text
operator-supplied inputs (regional extract + reference geometry + coastline polygons)
   -> validated and hashed before any tool starts
      -> pinned external tile tool (provisioning only, container or local runtime)
         -> vector tiles in the pinned schema
         -> PMTiles archive written into a staging directory
            -> glyphs, sprites and style document generated beside it
               -> validated in staging, then promoted into the inactive slot
                  -> atomic active-pointer replacement
                     -> GET /maps/v1/{snapshotId}/... through the same-origin gateway
                        -> archive protocol in the browser
                           -> renderer
```

The synthetic builder replaces only the first two steps. Everything downstream is identical, which
is why the automated tests exercise the real pipeline without any download.

## Processes

- **gateway** provides one browser origin and routes `/` to Web, `/api/*` to API and `/maps/*` to
  the API's resource reader with buffering disabled so byte ranges stream.
- **web** renders operational status and, when a basemap is installed, the map. No remote assets.
- **api** provides liveness, readiness, capability, dataset and basemap endpoints, and serves
  versioned basemap resources from a read-only mount of the active snapshot.
- **cli** reports local state and performs operator-initiated dataset provisioning.
- **updater** is a separate process with its own health endpoint and update-connectivity state.

The API has request IDs, JSON logs, bounded request and proxy timeouts, safe error responses, and
signal-driven graceful shutdown. The updater also handles termination cleanly.

## Basemap contract

The descriptor is a discriminated union with three arms, so availability is reported truthfully:

- `not_installed` — no dataset has ever been activated on this host;
- `unavailable` — a dataset is installed but cannot be served, carrying a reason
  (`snapshot_missing`, `snapshot_mismatch`, `snapshot_corrupt`, `region_mismatch`,
  `basemap_missing`) and a human-readable detail;
- `ready`.

Distinguishing the first two matters: an operator must see that something is broken rather than
that nothing was ever installed. `datasetStatus()`, `capabilities()` and `basemap()` are all
derived from a single resolution of the stored dataset, so the three surfaces — and the HTTP
endpoints, Web UI and doctor output built on them — cannot disagree.

Neither unavailable arm contains a consumable resource location: no snapshot ID, no URL, no
bounds. The ready variant records the local,
versioned archive URL, the `mvt` vector format, the `application/vnd.pmtiles` archive media type,
bounds, zoom range, attribution, and local style, glyph and sprite URLs, without naming a
rendering SDK.

MVT is the encoding of each vector tile. PMTiles is the single-file archive that contains those
tiles and supports addressing them by byte range. The two are recorded separately in the manifest
and in the descriptor, because an archive could in principle hold raster payloads; validation
rejects a snapshot whose archive is not vector data.

### Resource URLs are immutable

Every resource path embeds the snapshot ID, so activating a new snapshot mints new URLs rather
than changing the bytes behind existing ones. That is what makes
`cache-control: public, max-age=31536000, immutable` correct.

Keeping that promise takes more than minting distinct URLs, because a slot is a directory a later
preparation replaces by rename. The reader therefore opens the file first, confirms afterwards
that the slot still holds the snapshot the URL names, and streams from the open handle rather than
re-resolving the path. It fails closed: if the slot changed at any point, the request is refused
rather than answered from a different snapshot. The active snapshot and the previous one it
replaced are addressable; staged and candidate snapshots never are.

Resource paths are origin-relative. Nothing stored on disk names a host or port, so the same
snapshot serves correctly however the gateway is reached. The Web application resolves those
paths against its own origin before handing the style to the renderer, which requires an absolute
sprite URL; that adaptation lives in the application that owns the renderer.

## What M1 does not add

No search, reverse geocoding, routing, matrix, isochrone or map matching; no raster basemap,
imagery, terrain or traffic; no scheduled downloader, replication or public network call; no new
data service. Those remain represented as `not_installed` capability states and typed errors.
