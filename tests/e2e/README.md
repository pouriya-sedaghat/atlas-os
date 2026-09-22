# Browser end-to-end tests

`pnpm test:e2e` runs `basemap.spec.ts` against two complete same-origin stacks started by
`playwright.config.ts`: one backed by a host with a provisioned basemap, and one backed by a host
with no dataset at all. Both use the real built Web bundle and the real API process, so the
no-dataset path is exercised against a genuine backend rather than a stub.

`global-setup.ts` provisions the fixture snapshot with `scripts/provision-fixture.mjs`, which runs
the same command-line tool an operator uses.

The assertions are functional, not screenshot comparisons: a renderer canvas exists and is sized,
the archive is read through byte-range requests, the style, glyph and sprite resources are fetched
from this origin, the application reports which vector layers actually produced geometry, the label
language toggle changes the configured language, and **no browser request targets a non-local
origin**.

Set `ATLAS_E2E_CHROMIUM_PATH` to reuse a Chromium already present on the host.
