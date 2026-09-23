# Offline-first runtime

Normal user requests are served by local processes from local data. Internet access is reserved
for explicitly operator-initiated provisioning; it is never a readiness dependency for the Web
application, the API, or the basemap.

## What this means in M1

- The Web bundle contains no CDN, hosted style, hosted glyph, hosted sprite, hosted font,
  analytics or telemetry URL. The renderer, its worker, and the right-to-left text plugin are all
  bundled or copied into the application's own static assets.
- Glyphs are generated at provisioning time from a font committed to this repository, so text
  rendering needs no font service.
- The basemap archive, style, sprites and glyphs are served from the same origin as the
  application, through the gateway.
- The API and updater make no scheduled or startup network request.
- The updater reports `offline` when `ATLAS_OFFLINE=true` and stays healthy. Absence of internet
  is an update condition, never a runtime incident.
- Starting with no dataset at all is a valid, healthy mode.
- Package and image downloads are provisioning activities, not runtime behaviour.

## Network topology

`api`, `web` and `updater` attach only to an `internal: true` Compose network, so they have no
route off the host. The `gateway` additionally attaches to a normal bridge network, because
publishing a host port requires one; that is the single service with an external route, and it is
published only on `127.0.0.1`. It has no upstream outside the deployment: its only `proxy_pass`
targets are the `api` and `web` services.

## Attribution links are not resource dependencies

The basemap's attribution is a licence obligation: the tile schema requires visible credit for
both the schema project and the map data's contributors, as hyperlinks. Those anchors appear in
the attribution control, which is rendered expanded rather than collapsed so the credit is
actually visible.

They are **navigational links a person may click**, not resources the page fetches. Nothing
requests them while the map renders. The offline guarantee is therefore expressed over _fetched_
resources — the tile archive, the style, glyphs, sprites, fonts and the text-shaping plugin, all
of which must be same-origin — and is enforced by asserting that **no browser request** targets a
non-local origin. A blanket ban on every URL appearing in a style document would force a choice
between correct licensing and a meaningful offline guarantee, so it is not used.

The renderer's own attribution control likewise contributes a link to its project page. Same
principle: a link, not a request.

## Reproducible verification

Provision while registries are reachable:

```sh
pnpm install --frozen-lockfile
pnpm compose:build
pnpm exec playwright install --with-deps chromium
```

Then verify:

```sh
pnpm test:e2e       # asserts zero non-local browser requests, with the map rendering
pnpm test:offline   # starts the Compose stack and exercises the full runtime
```

The browser suite fails if the page contacts any origin other than loopback, so a reintroduced CDN
reference is caught rather than merely discouraged. The offline smoke test provisions a snapshot on
the host, mounts it read-only, and verifies the gateway, Web application, API health and readiness,
the ready dataset and basemap states, a ranged archive read and `416` handling, local style, glyph
and sprite resources, traversal rejection, the locally served text plugin, and the updater's
offline state — then removes its stack.

A future update attempt may be deferred or retried while the active snapshot continues serving.
