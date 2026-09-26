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
shell, a process supervisor, or Compose. To set one for the current session, use
`export ATLAS_API_PORT=3100` in a POSIX shell, `$env:ATLAS_API_PORT = "3100"` in PowerShell, or
`set ATLAS_API_PORT=3100` in Command Prompt.

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

Search tooling follows the same rule. By default it follows the tile tool: an extract-based
preparation also builds search from the same extract, and the synthetic tile fixture stays
basemap-only.

| Variable                         | Default               | Purpose                                                                                                     |
| -------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ATLAS_SEARCH_TOOL_KIND`         | follows the tile tool | `external` (same extract), `synthetic` (fixture) or `none` (basemap-only)                                   |
| `ATLAS_SEARCH_TOOL_MODE`         | `container`           | Run the search tools in the local images (`container`) or directly (`local`)                                |
| `ATLAS_SEARCH_ENGINE_ARCHIVE`    | _(unset)_             | Local mode: the engine archive, verified against its pinned digest                                          |
| `ATLAS_SEARCH_ENGINE_JAVA`       | `java`                | Local mode: the Java 21 runtime                                                                             |
| `ATLAS_SEARCH_BUILD_SCRIPT`      | _(unset)_             | Local mode, extracts: the database build script                                                             |
| `ATLAS_SEARCH_IMPORT_HEAP`       | `2g`                  | Engine heap during import and build-time verification                                                       |
| `ATLAS_SEARCH_BUILD_THREADS`     | processors, at most 8 | Parallelism of the database build and import                                                                |
| `ATLAS_SEARCH_TOOL_MEMORY_LIMIT` | `4g`                  | Container mode: hard memory limit of each provisioning container, with no swap; must exceed the import heap |
| `ATLAS_SEARCH_TOOL_PIDS_LIMIT`   | `4096`                | Container mode: the most processes and threads in each provisioning container                               |
| `ATLAS_BUILD_*`                  | _(unset)_             | Local mode: passed to the build script unchanged                                                            |

Mixing sources is refused: synthetic search needs synthetic tiles, and extract-based search needs
extract-based tiles, because one snapshot has one source.

Every provisioning container runs under both limits. They bound the containers; they are not a
size for any region, and nothing here has measured one. Set them from a measured run of your own
extract. A tool that fails reports its exit status, the limits in force and, where the status
says, a reason: `killed_by_signal` (status 137, which with a memory limit and no network almost
always means the memory limit) or `runtime_out_of_memory` (status 3: the heap is exhausted, or the
PID limit refused a thread). Local mode runs the tools directly and sets no container limits.
If stopping the temporary PostgreSQL cluster cannot be confirmed, the search build exits with
an error and preserves the private staging tree under `<data-root>/tmp/prepare-*/`, including
the database and socket directory at `search-work/database/`. In local mode, inspect and stop
that process before removing the preserved directory. The active slot is unaffected.

### Search hosts

Each search host serves one slot. In Compose only `ATLAS_SEARCH_SLOT` is set; the other values
default to the search image's layout.

| Variable                                 | Default                 | Purpose                                                    |
| ---------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| `ATLAS_SEARCH_SLOT`                      | _(required)_            | `blue` or `green`                                          |
| `ATLAS_SEARCH_WORK_ROOT`                 | `/var/lib/atlas-engine` | The host's own working volume                              |
| `ATLAS_SEARCH_HOST_ADDRESS`              | `0.0.0.0`               | Address of the private host protocol                       |
| `ATLAS_SEARCH_HOST_PORT`                 | `2322`                  | Port of the private host protocol                          |
| `ATLAS_SEARCH_ENGINE_HEAP`               | `1g`                    | Engine heap while serving                                  |
| `ATLAS_SEARCH_ENGINE_PORT`               | `2321`                  | The engine's loopback port inside the host                 |
| `ATLAS_SEARCH_HOST_RESERVE_BYTES`        | `268435456`             | Free space kept beyond a working copy being built          |
| `ATLAS_SEARCH_HOST_FENCE_MS`             | `0`                     | Optional delay before the final identity check; not needed |
| `ATLAS_SEARCH_ENGINE_STARTUP_TIMEOUT_MS` | `300000`                | How long an engine may take to start                       |
| `ATLAS_SEARCH_HOST_POLL_MS`              | `1000`                  | How often the slot is re-read                              |
| `ATLAS_SEARCH_HOST_RETRY_MS`             | `30000`                 | How long a failed load waits before it is retried          |

The API reaches the hosts through `ATLAS_SEARCH_ENGINE_BLUE_URL` and
`ATLAS_SEARCH_ENGINE_GREEN_URL` (plain `http` origins on the internal network). An unset URL means
that slot has no search host, and search reports `not_installed` for it.

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
pnpm basemap:fixture
pnpm api:start:fixture
```

`pnpm basemap:fixture` prepares, validates and activates a snapshot into `.validation/fixture-data`,
and `pnpm api:start:fixture` starts the API against it. Both run as written in PowerShell, Command
Prompt and POSIX shells.

This generates a small synthetic archive with the same source layers, attributes and label
languages as a production build. It is a test scaffold, not a map of any territory.

`pnpm api:start:fixture` passes the API an absolute data root. Pointing
`pnpm --filter @atlas-os/api start` at the fixture with a relative path does not work: pnpm runs a
package's script from that package's directory, so the path would resolve beneath `apps/api`. The
command keeps `ATLAS_DATA_ROOT` and `ATLAS_ACTIVE_SNAPSHOT_PATH` if you have already set them, and
reports what to run if the API has not been built or the fixture has not been provisioned.

### Developer fixture with search

```sh
pnpm build
pnpm compose:build
pnpm dataset:fixture
```

`pnpm dataset:fixture` prepares the fixture snapshot with the synthetic search fixture, imported
and proved by the real engine in the local images, and activates it. On a Linux machine
with a Java 21 runtime and the pinned engine archive, the images are not needed:

```sh
node scripts/provision-fixture.mjs .validation/fixture-data --search --search-mode local --engine-archive path/to/photon-1.3.0.jar
```

The archive is checked against its pinned digest before use. Only one real engine runs at a time
on a machine in local mode, because the engine binds fixed loopback ports; in Compose each host
has its own network namespace.

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

On the Linux host that will hold the dataset, from a POSIX shell:

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

With the default tooling, the same `prepare` also builds search from the extract, in the local
search images (`pnpm compose:build` builds them), with no network. Set
`ATLAS_SEARCH_TOOL_KIND=none` in the shell for a basemap-only snapshot.

Activation waits for search: `update activate` refuses with `SEARCH_NOT_READY` until the local
API reports the standby search host ready for exactly that snapshot. Pass
`--activate-while-search-starting` after the snapshot ID to activate anyway; search then reports
`starting` until its host has loaded the new generation. See
[data lifecycle](data-lifecycle.md).

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

Search for a real region has **not been measured** here. On the tiny test extract the whole search
preparation took under 30 seconds and a sealed database of about 100 KB, served by an engine
using about 340 MB resident at a 512 MB heap; none of that extrapolates. The engine's upstream
documentation puts a planet-wide database near 95 GB with at least 64 GB of memory recommended; a
single country is a small fraction of that, but plan the database build, the four on-disk copies
(two sealed, two working, and one more on a host while it replaces its copy), each host's heap and
every container's memory and PID limits from a measured first run. Hosts refuse to start rather
than fill a volume.

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
pnpm dataset:fixture   pnpm test:engine          pnpm test:engine:jar
```

`pnpm test:engine` is the end-to-end engine gate, and passes only when the tiny-extract pipeline
ran and passed. In container mode (Docker available) it builds the provisioning and serving images
and runs the pipeline through them. In local mode it needs `ATLAS_SEARCH_ENGINE_ARCHIVE`, a Java 21
runtime and a working local database build in `ATLAS_SEARCH_BUILD_SCRIPT`, and also runs the
synthetic engine suite. It reads the test report and fails when a required test was skipped or never
ran. When it cannot run the pipeline it exits with status 2 and says so: that is unexecuted, never a
pass.

`pnpm test:engine:jar` is a partial run, named and reported as one: the synthetic fixture through
the real engine and host with a local runtime and no database build. Its result never covers the
pipeline.

### Browser tests

```sh
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

The suite provisions two fixture datasets, then starts four complete same-origin stacks: one with
a basemap-only snapshot, one with no dataset at all, one with the synthetic search fixture behind
the production search host, and one whose search hosts are not reachable yet, so the unavailable
and starting paths are exercised against a real backend. The search host runs the engine
stand-in unless `ATLAS_SEARCH_ENGINE_ARCHIVE` names the pinned engine archive, in which case the
fixture is imported, proved and served by the real engine. Set `ATLAS_E2E_CHROMIUM_PATH` to use a
Chromium already present on the host instead of downloading one.

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
resources, traversal rejection, the locally served right-to-left text plugin, Persian search and
reverse geocoding from the per-slot search hosts, engine-port isolation, read-only slots, and the
updater's offline state. It collects Compose status and per-service logs on failure and removes
its stack and volumes afterwards.

If Docker is unavailable, these commands are unexecuted — not passed — and must be run on a Docker
host before release.

## Compose runtime

On a Linux host, from a POSIX shell:

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

`search-blue` and `search-green` each serve one slot. Set `ATLAS_SEARCH_ENGINE_HEAP` in the shell
before `up` to size both engines' heaps (default `1g`); each host's working volume needs free space
for two copies of its slot's search database, because a replacement is built beside the copy being
served.

Each host container also runs under hard limits: `ATLAS_SEARCH_HOST_MEMORY_LIMIT` (default `2g`,
with no swap beyond it) covers the host, the engine's heap and everything outside the heap, and
`ATLAS_SEARCH_HOST_PIDS_LIMIT` (default `1024`) caps its processes and threads. The defaults are
bounds, not sizes. After a measured first run, set the memory limit from the container's peak
memory with headroom, and the heap below it. When the engine stops on its own, the host fails
closed at once, reloads from the sealed slot, and reports why in its status diagnostics and log —
`memory_limit`, `pids_limit`, `heap_exhausted` or `exited` — together with the limits it reads
from the kernel.

## Windows and Linux

- **Written to run natively on Windows and Linux:** installation, the build, every `pnpm check`
  gate, the browser suite with the engine stand-in, and every command in this guide and the README,
  which contain no POSIX-only syntax. The engine stand-in and the search host tests use only Node.
- **Linux containers, including Docker Desktop's Linux containers on Windows:** the search
  provisioning image, the real engine and the search hosts. This is the supported way to prepare
  and serve search on any operating system.
- **Local tooling mode** (`--search-mode local`, `pnpm test:engine` in local mode) is used on Linux.
  Running the real engine or the database build natively on Windows has not been proved and is not
  supported.
