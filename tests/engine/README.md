# Engine tests

`pnpm test:engine` runs these against the real, pinned search engine. They are skipped by every
other test command.

- `engine.test.ts`: the synthetic fixture imported, sealed and proved by the real engine through
  the production pipeline, then loaded read-only by the production host and asked Persian and
  English questions; slot replacement, restart identity and slot immutability. Local mode only.
- `pipeline.test.ts`: a tiny, deterministic OpenStreetMap extract through the whole production
  path — the database builder in reverse-only mode with no updates, its export, post-processing,
  import, sealing, probe selection and the host — with questions whose answers are known in
  advance. Container mode runs the tools and the host in this repository's images; local mode
  runs the same build script with database tools installed on the machine.

In container mode the host runs as the serving image's user, with the same constraints as in
Compose. Its work root is a tmpfs owned by that user with mode `0700`, because unlike a Compose
named volume a tmpfs does not take its owner from the image (`tests/helpers/container-host.ts`).
If the host container stops before it is ready, the test fails at once with the container's exit
state and the end of its output, captured before the container is removed.

`scripts/test-engine.mjs` chooses the mode, verifies its prerequisites, and exits with status 2 —
unexecuted, not passed — when the pipeline cannot run: `pnpm test:engine` passes only when the
pipeline ran and passed, and it reads the test report so a skipped suite fails it. The partial
command, `pnpm test:engine:jar`, runs `engine.test.ts` alone with a local runtime and reports itself
as partial.
