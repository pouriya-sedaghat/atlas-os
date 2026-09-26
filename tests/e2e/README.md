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

`search.spec.ts` adds two more stacks over a dataset with the synthetic search fixture: one served
by the production search host for each slot, and one whose API cannot reach any search host, so
search is truthfully `starting`. It covers the Persian combobox from the keyboard (debounce,
two-letter minimum, one request per pause, arrow keys, Enter, Escape, the live-region count),
Arabic letter variants, the marker, the explicit reverse actions, the disabled and starting states,
dropping an answer from another snapshot and moving to it, and zero non-local requests throughout.

`provision-search.ts` builds that dataset through the production provisioner, and
`start-search-host.ts` runs the production host for one slot. Both use the engine stand-in unless
`ATLAS_SEARCH_ENGINE_ARCHIVE` names the pinned engine archive, in which case the real engine
imports, proves and serves the fixture. The snapshot-transition test needs two engines at once and
is skipped with the real engine, which binds fixed loopback ports.

Playwright starts the web servers before global setup, so the search hosts may first see the
previous run's dataset and log failed loads until global setup has replaced it; they fail closed
and then load the new snapshot.

`pnpm test:e2e` owns a private, per-run work tree and removes it after Playwright exits,
even if a search host was forcibly stopped. Use this command rather than calling
`playwright test` directly; the two search hosts require its run-root environment.
On Linux, Playwright also gives the hosts time to stop cleanly before they exit.
