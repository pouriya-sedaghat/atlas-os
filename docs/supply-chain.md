# Supply-chain controls

M0 pins direct JavaScript dependencies in package manifests and locks the complete dependency graph
with pnpm 10.17.1. A workspace override keeps every optional peer resolution on the Node
22-compatible `@types/node` 22.20.4 line. CI installs with `--frozen-lockfile`.

GitHub Actions use full commit SHAs rather than mutable major-version tags. The adjacent comments
record the tracked major line. The pinned commits were resolved from each upstream repository's
`refs/tags/v4` when this foundation was prepared.

Container `FROM` references use a human-readable version tag together with the immutable
multi-platform manifest digest:

| Image              | Immutable reference                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Node.js            | `node:22.14.0-alpine3.21@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944`                   |
| NGINX Unprivileged | `nginxinc/nginx-unprivileged:1.27.5-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0` |

There are no unpinned external base-image exceptions in M0. Image digests should be refreshed only
through an explicit dependency update that reruns all quality, image-content, and offline gates.

The root `.dockerignore` excludes local environment files, validation output, patches, tests,
documentation, source-control metadata, dependency directories, runtime data, and other non-build
artifacts. `.env.example` is explicitly preserved. `pnpm test:container` enforces the context and
Dockerfile policies without Docker. After building, `pnpm images:inspect` verifies that the API and
updater application payloads contain only compiled output, package metadata, and production
dependencies.
