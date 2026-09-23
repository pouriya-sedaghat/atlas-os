# Development

## Prerequisites

- Node.js 22.14.0 or newer
- pnpm 10.17.1
- Docker with Compose v2 for container, image and offline checks
- A Chromium build for browser tests (`pnpm exec playwright install chromium`)

Install exactly what the lockfile declares:

```sh
pnpm install --frozen-lockfile
```

## Configuration

Configuration is validated at startup. Relative paths resolve from the process working directory.

| Variable                     | Default                                | Purpose                                      |
| ---------------------------- | -------------------------------------- | -------------------------------------------- |
| `ATLAS_PROFILE`              | `default`                              | Environment/profile name                     |
| `ATLAS_REGION`               | `iran`                                 | Region descriptor ID                         |
| `ATLAS_REGION_CONFIG_PATH`   | `./config/regions/<region>.yaml`       | Region descriptor to load                    |
| `ATLAS_API_HOST`             | `127.0.0.1`                            | API bind address                             |
| `ATLAS_API_PORT`             | `3000`                                 | API port                                     |
| `ATLAS_GATEWAY_ORIGIN`       | `http://127.0.0.1:8080`                | Browser-facing local origin                  |
| `ATLAS_DATA_ROOT`            | `./data`                               | Runtime data root                            |
| `ATLAS_ACTIVE_SNAPSHOT_PATH` | `./data/active.json`                   | Active pointer path                          |
| `ATLAS_FONT_PATH`            | `./assets/fonts/Vazirmatn-Regular.ttf` | Font glyph ranges are generated from         |
| `ATLAS_BASEMAP_BUILDER`      | `external`                             | `external` (operator extract) or `synthetic` |
| `ATLAS_TILE_TOOL_MODE`       | `container`                            | Run the tile tool as `container` or `jar`    |
| `ATLAS_TILE_TOOL_ARCHIVE`    | _(unset)_                              | Path to a local tile-tool archive, jar mode  |
| `ATLAS_LOG_LEVEL`            | `info`                                 | Structured log level                         |
| `ATLAS_UPDATE_MODE`          | `disabled`                             | `disabled` or `manual`                       |
| `ATLAS_OFFLINE`              | `true`                                 | Treat update connectivity as offline         |
| `ATLAS_UPDATER_HOST`         | `127.0.0.1`                            | Updater health bind address                  |
| `ATLAS_UPDATER_PORT`         | `3001`                                 | Updater health port                          |

`.env.example` has no secrets. Applications do not load dotenv files; supply variables through the
shell, a process supervisor, or Compose.

### Provisioning tooling

These are read **only inside `packages/atlas-os`**. Neither the core layer nor any application
interprets them, and no command-line flag selects a tool: provider selection is not an
application-facing option.

| Variable                  | Default     | Purpose                                               |
| ------------------------- | ----------- | ----------------------------------------------------- |
| `ATLAS_TILE_TOOL_KIND`    | `external`  | `external` (operator-supplied inputs) or `synthetic`  |
| `ATLAS_TILE_TOOL_MODE`    | `container` | Run the external tool as a container or a local jar   |
| `ATLAS_TILE_TOOL_ARCHIVE` | _(unset)_   | Path to a local tool archive, used only in `jar` mode |

The default is the production path. A deployment that configures nothing gets the external tool,
never the generated development fixture.

## Development processes

```sh
pnpm --filter @atlas-os/api dev
pnpm --filter @atlas-os/web dev
pnpm --filter @atlas-os/updater dev
pnpm --filter @atlas-os/cli dev -- doctor
```

The Web development server proxies `/api` and `/maps` to the local API, so the browser sees one
origin exactly as it does in production.

## Provisioning a basemap

Provisioning is explicit and operator initiated. It is never triggered by serving traffic, and the
API process is composed without the ability to perform it.

### Developer fixture, no download required

```sh
pnpm build
pnpm basemap:fixture              # prepares, validates and activates into .validation/fixture-data
ATLAS_DATA_ROOT=.validation/fixture-data pnpm --filter @atlas-os/api start
```

This generates a small synthetic archive with the same source layers, attributes and label
languages as a production build. It is a test scaffold, not a map of any territory.

### Production, from operator-supplied inputs

The tile schema this basemap derives from is built from **more than the OpenStreetMap extract**.
Its layers also read small-scale reference geometry and pre-processed coastline polygons, and the
tool does not require those files to exist when it starts — a missing one surfaces as a late
failure or, where the stage is skipped, as a basemap quietly missing that layer's data. Every
required input is therefore resolved, checked and hashed _before_ the tool is started, and a
preparation that is missing one is refused.

Which inputs a preparation requires is derived from the layers the basemap style draws:

| Input role           | Needed by                                   | Conventional file                 |
| -------------------- | ------------------------------------------- | --------------------------------- |
| `region-extract`     | every layer                                 | `<region>.osm.pbf`                |
| `reference-features` | water, boundary, place, transportation      | `natural_earth_vector.sqlite.zip` |
| `coastline-polygons` | water                                       | `water-polygons-split-3857.zip`   |
| `lake-centerlines`   | water labels only — not drawn by this style | `lake_centerline.shp.zip`         |

Obtain each file through your own approved channel and place it on the host. None of them is ever
downloaded by this software, and none is committed. Record each in `DATA_SOURCES.md`.

```sh
export ATLAS_DATA_ROOT=/var/lib/atlas
export ATLAS_TILE_TOOL_KIND=external
export ATLAS_TILE_TOOL_MODE=container          # or: jar, with ATLAS_TILE_TOOL_ARCHIVE=/path/to.jar

node apps/cli/dist/index.js update prepare \
  --source-name "iran-osm-2026-09-01" \
  --source-timestamp 2026-09-01T00:00:00.000Z \
  --region-extract /srv/sources/iran.osm.pbf \
  --reference-features /srv/sources/natural_earth_vector.sqlite.zip \
  --coastline-polygons /srv/sources/water-polygons-split-3857.zip

node apps/cli/dist/index.js update validate <snapshot-id>
node apps/cli/dist/index.js update activate <snapshot-id>
node apps/cli/dist/index.js update list
node apps/cli/dist/index.js rollback
```

Each input may also carry `--<role>-name` and `--<role>-timestamp` for provenance. The snapshot
manifest records each input's name, file name, byte count, SHA-256 and timestamp — never the
absolute host path.

The tool runs with `--network=none`, mounts every input read-only, and is given only local paths:
downloading is disabled, the tool's own translation cache is disabled, and no source URL is ever
passed. It is provisioning tooling only, never installed in or invoked from the serving images.

> **Not executed here.** The pinned tool image cannot be pulled in the environment this change was
> prepared in, so a full production build has not been run. The command line, the mounts and the
> pre-flight input checks are covered by tests; that is not the same as an executed build, and a
> first real run should be validated end to end.

### Storage and hardware for an Iran build

A country-scale build is the demanding step, not serving. Plan for roughly:

| Resource | Guidance                                                                      |
| -------- | ----------------------------------------------------------------------------- |
| Input    | An Iran `.osm.pbf` is on the order of 0.5–1 GB                                |
| Scratch  | Allow several times the input size in `data/tmp` for the tool's working files |
| Output   | A zoom 0–14 archive for Iran is on the order of 1–3 GB                        |
| Slots    | Two slots plus staging, so budget roughly three times the archive size        |
| Memory   | 8 GB is a reasonable floor for a country-scale build; more shortens it        |
| Time     | Tens of minutes on a modern multi-core host                                   |
| Serving  | Modest: the API streams byte ranges and never loads the archive into memory   |

These are planning figures for the build host, not measurements of this repository. The exact
output size depends on the extract, the zoom range and the layer selection, and should be measured
on first use for your own data.

## Command-line exit codes

| Code | Meaning                                                                    |
| ---- | -------------------------------------------------------------------------- |
| 0    | The command completed                                                      |
| 1    | The command ran but the operation failed                                   |
| 2    | Another dataset operation holds the lock, or there is nothing to roll back |
| 3    | A snapshot did not validate                                                |
| 4    | The referenced snapshot does not exist                                     |
| 64   | The command line could not be understood                                   |
| 78   | Configuration is invalid                                                   |

Every command prints one JSON document on stdout, so output is machine readable by default.

## Quality gates

```sh
pnpm check       # everything that needs no browser and no Docker daemon
pnpm verify      # pnpm check, then the browser end-to-end suite
```

`pnpm check` runs formatting, lint, strict TypeScript, unit, contract, integration, provisioning,
boundary and container-policy tests, the production build, and Compose configuration validation.

Individual gates:

```text
pnpm format            pnpm test:unit            pnpm build
pnpm format:check      pnpm test:contract        pnpm compose:config
pnpm lint              pnpm test:integration     pnpm compose:build
pnpm typecheck         pnpm test:provisioning    pnpm images:inspect
pnpm test              pnpm test:boundaries      pnpm test:offline
pnpm basemap:fixture   pnpm test:container       pnpm test:e2e
```

### Browser tests

```sh
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

The suite provisions a fixture snapshot, then starts two complete same-origin stacks: one with the
basemap installed and one with no dataset at all, so the no-dataset path is exercised against a
real backend. Set `ATLAS_E2E_CHROMIUM_PATH` to use a Chromium already present on the host instead
of downloading one.

### Docker and offline verification

```sh
pnpm compose:config
pnpm compose:build
pnpm images:inspect
pnpm test:offline
```

`pnpm test:offline` provisions a fixture on the host, starts the Compose stack with that snapshot
mounted read-only, and checks the gateway, Web application, API health and readiness, the ready
dataset and basemap states, a ranged archive read, `416` handling, local style, glyph and sprite
resources, traversal rejection, the locally served right-to-left text plugin, and the updater's
offline state. It collects Compose status and per-service logs on failure and removes its stack
afterwards.

If Docker is unavailable, these commands are unexecuted — not passed — and must be run on a Docker
host before release.

## Compose runtime

```sh
export ATLAS_DATA_ROOT=/var/lib/atlas
docker compose -f infra/compose/compose.yaml up --build --wait
```

Open `http://127.0.0.1:8080`. Containers run without privilege escalation, drop Linux
capabilities, use read-only roots with bounded temporary filesystems, and share only an internal
network; the dataset is mounted read-only. No Docker socket or secret is mounted. Only the gateway
publishes a port, and only on loopback.

Starting without a dataset is a valid, healthy mode: the Web application reports that no basemap
is installed and keeps showing live status.
