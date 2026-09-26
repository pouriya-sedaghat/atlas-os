# Supply-chain controls

Direct JavaScript dependencies are pinned to exact versions in package manifests, and the complete
graph is locked with pnpm 10.17.1. A workspace override keeps every optional peer resolution on the
Node 22-compatible `@types/node` 22.20.4 line. CI installs with `--frozen-lockfile`. A test asserts
that no direct dependency uses a range rather than an exact version.

## Verification performed

Every version added in M1 was confirmed against its official registry or repository before it was
pinned:

| Dependency                   | Version | Licence      | Source of truth           |
| ---------------------------- | ------- | ------------ | ------------------------- |
| `maplibre-gl`                | 6.10.0  | BSD-3-Clause | npm registry              |
| `pmtiles`                    | 4.5.0   | BSD-3-Clause | npm registry              |
| `@maplibre/geojson-vt`       | 6.1.1   | ISC          | npm registry              |
| `@maplibre/vt-pbf`           | 4.3.2   | MIT          | npm registry              |
| `pbf`                        | 5.1.2   | BSD-3-Clause | npm registry              |
| `fontkit`                    | 2.0.4   | MIT          | npm registry              |
| `@mapbox/mapbox-gl-rtl-text` | 0.4.0   | BSD-2-Clause | npm registry              |
| `@mapbox/vector-tile`        | 3.0.0   | BSD-3-Clause | npm registry              |
| `yaml`                       | 2.9.1   | ISC          | npm registry              |
| `@playwright/test`           | 1.63.0  | Apache-2.0   | npm registry              |
| External tile tool           | 0.10.2  | Apache-2.0   | Maven Central coordinates |

## GitHub Actions

Actions are pinned to full commit SHAs rather than mutable major-version tags; the adjacent
comment records the tracked major line. A test rejects any `uses:` reference that is not a
40-character SHA.

## Container images

`FROM` and `image:` references use a human-readable version tag together with the immutable
multi-platform manifest digest:

| Image              | Immutable reference                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Node.js            | `node:22.14.0-alpine3.21@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944`                   |
| NGINX Unprivileged | `nginxinc/nginx-unprivileged:1.27.5-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0` |
| External tile tool | `ghcr.io/onthegomap/planetiler:0.10.2@sha256:cf32202dbc001a9ab4bc11534b642b13de3798179817da8558e567a3d13dd403`      |

The tile-tool digest was resolved from its official registry. That image is **provisioning
tooling**: it is referenced only from `packages/atlas-os/src/internal/tools/`, is never built into
or pulled by a request-serving image, and is invoked with `--network=none`.

### How the tool's contract was established

Its source names, command-line flags, schema identity and attribution were read from the pinned
artifacts rather than assumed:

- the tool's sources jar on Maven Central, SHA-256
  `fb5809f2d55e2ff3583c71f4b5b530957c633bb29dd456ca11fd0d2d56630fc3` (verified on download),
  which shows that a source registered under name `X` is overridden by the flag `X_path`, that
  argument keys normalise `.`, `-` and `_` equivalently, that downloading defaults to off, and
  that the tool's translation cache defaults to **on** and must be disabled explicitly;
- the tile schema profile at the exact commit the tool's v0.10.2 tag pins,
  `91516fdf477915b1a985015811049b9b96c7f87e`, which gives the four source names the profile
  registers, which of its layers consume each one, and the attribution and schema version the
  profile declares.

Two assumptions were corrected by this: the lake-centreline source is named `lake_centerlines`
(plural), and the schema version is 3.16.0.

### Search images and tooling (M2)

| Artifact                     | Pin                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js, glibc (search host) | `node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b`                                                                      |
| Java 21 runtime, glibc       | `eclipse-temurin:21.0.12_8-jre-noble@sha256:7739f0ffce786528961eea6bf46d9610ee968ac6127c9b2e93494757bdecce9f`                                                             |
| Search engine archive        | `https://github.com/komoot/photon/releases/download/1.3.0/photon-1.3.0.jar`, 98,219,380 bytes, SHA-256 `a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5` |
| Provisioning system packages | Ubuntu 24.04 from the dated snapshot `20260920T000000Z`, every package at an exact version                                                                                |
| Provisioning Python packages | `infra/images/search-build/requirements.lock` and `build-backend.lock`, installed with `--require-hashes --no-deps`                                                       |

The Java runtime is glibc-based; a musl runtime is not proven for the engine. The engine archive is
verified by digest and size in both images and, in local tooling mode, by the platform before every
use. Its manifest records upstream commit `523a59b4`, whose tree matches the `1.3.0` tag. The
database builder is `nominatim-db` 5.3.2 from its hash lock, resolved on 2026-09-20 and verified to
install from the lock alone on CPython 3.12.

The two search images are built from this repository and never published. The serving image
(`infra/images/search.Dockerfile`) carries the compiled host, the runtime and the verified engine
archive only; the image audit proves the archive's digest, the runtime version, the absence of any
database, build or Python tooling, the non-root user and the ownership of its working volume. The
provisioning image (`infra/images/search-build.Dockerfile`) carries the database builder and is
started only by an explicit preparation, with no network, no capabilities and a read-only root.

## Search licensing

- **Engine.** Photon is Apache-2.0; its licence and an assembled third-party notice file travel
  with the images in `infra/images/search/licenses/`. The archive bundles about 140 components.
  A single archive keeps only one `META-INF/NOTICE`, so the notices were assembled from each
  bundled component's own official artifact on Maven Central, after proving by class presence
  which components the pinned archive actually contains. The file records the method.
- **Components offered under a choice of licences** include Jetty (EPL-2.0 or Apache-2.0), JNA
  (LGPL-2.1-or-later or Apache-2.0) and the Jakarta APIs (EPL-2.0 or GPL-2.0 with the Classpath
  Exception). Which licence applies to a redistribution is the owner's decision.
- **Components whose artifacts carry no licence text** are listed in the notice file with their
  declared licence. Six pinned upstream texts for components with one licence are included in
  `infra/images/search/licenses/components/`. For the remaining three, pinned source texts
  and notices for both licence alternatives are included there as well. Their inclusion does
  not choose a licence: the owner must record the choice and review its distribution
  obligations. Both images that carry the engine archive copy this notices directory.
- **Java runtime.** Eclipse Temurin is GPL-2.0 with the Classpath Exception; its own legal notices
  are under `/opt/java/openjdk/legal` in the image.
- **Provisioning image.** It contains GPL-licensed software: the database builder
  (GPL-3.0-or-later), osm2pgsql and PostGIS (GPL-2.0-or-later), with PostgreSQL (PostgreSQL
  Licence). It is for local and CI builds only. Distributing it requires a licence and
  corresponding-source decision by the owner; nothing here publishes it.
- **Data.** A search database built from OpenStreetMap is a derived database under the ODbL. Its
  attribution is recorded and shown separately from the basemap's; see
  [`DATA_SOURCES.md`](../DATA_SOURCES.md).

There are no unpinned external base-image exceptions. Digests should be refreshed only through an
explicit dependency update that reruns every quality, image-content, browser and offline gate.

## Committed binary assets

One binary asset is committed: `assets/fonts/Vazirmatn-Regular.ttf`, 122752 bytes, SHA-256
`b69fd4c680b8f3f225feabcc655a2c585d97627b8f5f5c0f9985e894069f3a56`, under the SIL Open Font
License 1.1. Its provenance, licence and checksum are recorded in `assets/fonts/README.md`, and the
licence text travels with it as `assets/fonts/OFL.txt`. No other binary is committed; every
generated artifact lives under `data/` and is ignored by Git.

## Build context and runtime images

The root `.dockerignore` excludes local environment files, validation output, patches, tests,
documentation, source-control metadata, dependency directories, runtime data and other non-build
artifacts. `.env.example` is explicitly preserved. `pnpm test:container` enforces the context,
Dockerfile, Compose hardening, gateway routing and read-only dataset mount policies without Docker.
After building, `pnpm images:inspect` verifies that the API, updater and search host payloads
contain only compiled output, package metadata and production dependencies, and that the runtime
process is not root, and checks the search image's engine archive, runtime and working volume.

The Web application's static assets include one file copied verbatim from a pinned dependency, the
right-to-left text plugin. `scripts/vendor-web-assets.mjs` performs the copy at build time,
alongside the dependency's own licence text; the copy is generated, not committed.
