# Development

## Prerequisites

- Node.js 22.14.0 or newer
- pnpm 10.17.1
- Docker with Compose v2 for container and offline checks

Install exactly what the lockfile declares:

```sh
pnpm install --frozen-lockfile
```

## Configuration

Configuration is validated at startup. Relative data paths resolve from the process working
directory.

| Variable                     | Default                 | Purpose                              |
| ---------------------------- | ----------------------- | ------------------------------------ |
| `ATLAS_PROFILE`              | `default`               | Environment/profile name             |
| `ATLAS_REGION`               | `iran`                  | Region descriptor ID                 |
| `ATLAS_API_HOST`             | `127.0.0.1`             | API bind address                     |
| `ATLAS_API_PORT`             | `3000`                  | API port                             |
| `ATLAS_GATEWAY_ORIGIN`       | `http://127.0.0.1:8080` | Browser-facing local origin          |
| `ATLAS_DATA_ROOT`            | `./data`                | Runtime data root                    |
| `ATLAS_ACTIVE_SNAPSHOT_PATH` | `./data/active.json`    | Future active pointer                |
| `ATLAS_LOG_LEVEL`            | `info`                  | Structured log level                 |
| `ATLAS_UPDATE_MODE`          | `disabled`              | `disabled` or `manual` in M0         |
| `ATLAS_OFFLINE`              | `true`                  | Treat update connectivity as offline |
| `ATLAS_UPDATER_HOST`         | `127.0.0.1`             | Updater health bind address          |
| `ATLAS_UPDATER_PORT`         | `3001`                  | Updater health port                  |

`.env.example` has no secrets. Applications do not automatically load dotenv files; provide the
variables through the shell, process supervisor, or Compose.

## Development processes

```sh
pnpm --filter @atlas-os/api dev
pnpm --filter @atlas-os/web dev
pnpm --filter @atlas-os/updater dev
pnpm --filter @atlas-os/cli dev -- doctor
```

The CLI commands are `status`, `doctor`, `update check`, `update prepare`, `update activate`, and
`rollback`. Update mutation and rollback commands return exit code 2 with a typed M0 message.
Usage errors return 64, unhealthy checks return 1, and successful checks return 0.

## Quality gates

Run the full pre-commit gate:

```sh
pnpm check
```

This runs formatting, lint, strict TypeScript, unit, contract, integration, boundary,
container-policy, production build, and Compose configuration checks. Individual commands are
listed in the root README.

Docker validation and offline runtime testing:

```sh
pnpm compose:config
pnpm compose:build
pnpm images:inspect
pnpm test:offline
```

If Docker is unavailable, these commands are unexecuted—not passed—and must be run on a Docker
host before release.

## Compose runtime

```sh
docker compose -f infra/compose/compose.yaml up --build --wait
```

Open `http://127.0.0.1:8080`. Containers run without privilege escalation, drop Linux
capabilities, use read-only roots with bounded temporary filesystems, and share only an internal
network. No Docker socket or secret is mounted.

The API and updater images run compiled JavaScript directly with Node. Their `/app` payloads are
created by `pnpm deploy --prod` and contain only package metadata, `dist`, and production
dependencies. Source, tests, documentation, local environment files, the pnpm store, and
development dependencies are not copied into those runtime stages.
