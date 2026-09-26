# ADR 0001: Offline search and reverse geocoding

- Status: accepted for M2
- Scope: forward search and reverse geocoding for a region prepared from an operator-supplied
  OpenStreetMap extract, with no network at runtime

## Decision

Each snapshot carries a sealed search database built from the **same regional extract** as its
basemap. One private **search host** per slot (`search-blue`, `search-green`) serves it: each host
copies its slot's sealed database into its own disposable working volume, verifies the copy, starts
the pinned search engine (Photon 1.3.0) on loopback inside its own container, proves the running
engine holds exactly that generation, and only then answers, under a fresh random **load
identity**. The API answers `/v1/search` and `/v1/reverse` only when the active pointer, the active
manifest, the engine generation and that load identity agree before, during and after the query.

Preparation: extract → database builder in reverse-only mode with no updates (Nominatim 5.3.2,
offline, no network) → database export → Atlas post-processing (canonical search-only variants
under the private language `qaa`, canonical house numbers and postcodes with originals preserved,
unique import instant, generation canary) → engine import → seal → re-hash the extract →
probe selection by the real engine from a disposable copy → manifest → full validation →
promotion into the inactive slot.

## Rejected alternatives, with the measurements behind them

Measured on a tiny real fixture during the architecture spike, with the pinned engine archive:

- **Engine state inside the slot.** The engine cannot start from a read-only tree: it fails
  obtaining its node lock (`EROFS` on `node.lock`) and exits in about 1 s. Started from a writable
  tree it creates, deletes or changes 56 paths at start and stop (cluster state, translog
  generations, logs) while 600 queries change nothing. Serving from the slot would therefore
  modify the active slot, need a writable mount, and break the slot's own checksums, so rollback
  would refuse it.
- **An external search cluster with versioned indices.** The index name is fixed in the engine.
  Serving through an alias crashes the engine at startup (it reads the mapping keyed by the
  concrete index name). Isolating generations would need one cluster per generation, more
  services, the same writable state, and an unauthenticated administration interface (the
  embedded cluster accepted unauthenticated write-block, clone and delete calls on loopback).
- **Pelias.** An Elasticsearch cluster plus about fifteen services, images published on mutable
  tags, no Windows support, and the same writable-state problem; disproportionate for one region.
- **A new custom engine.** Replaces proven ranking, fuzzy and prefix matching, location bias and
  address formatting with an unbounded development effort, and still needs the database builder
  for the address hierarchy. Kept only as a documented fallback.
- **Any public or hosted geocoder.** Excluded: the runtime is offline. The public Nominatim
  service's usage policy also forbids client-side autocomplete.
- **The database builder as the runtime engine.** Its database cannot serve from a read-only data
  directory either, and it has no autocomplete.

Also measured: two embedded engines started concurrently in one network namespace collide on their
fixed internal ports, so each slot needs its own container; and the engine's own normalisation
fails for Arabic-letter variants at the first letter, for short prefixes, for Persian and
Arabic-Indic digits and for more than one diacritic, which is why canonical variants are added at
import and queries are canonicalised identically.

## Why a stale answer cannot be returned

The spike prototype used a fixed fence after a transition. Elapsed time is not a correctness
argument, so M2 replaces it. With the fence set to zero:

1. **Every load has an unpredictable identity.** A host mints a random UUID only after a load is
   verified: the working copy matches the sealed tree digest, the engine reports the import
   instant recorded in the manifest, the canary carries the full generation marker, and every
   recorded probe is answered as it was when the snapshot was built. A host restart, an engine
   crash and a slot reload all produce a new identity; the same snapshot never keeps its old one.
2. **A transition closes the gate first.** It clears the load, aborts every in-flight engine
   request and destroys the engine connection pool. The replacement working copy is built and
   verified beside the current one. At a single safe point — the replacement verified and still
   the slot's generation — the old engine stops and its copy is removed, and the replacement starts
   as a new process with its own connection pool; it opens only after it is verified, under a new
   identity. A replacement that fails leaves the old copy and engine intact behind the closed gate;
   if the slot shows that generation again, it is verified again and reopens under a new identity.
   A host answers a query only if the load
   it captured before forwarding is still the current load after the engine answers and again
   immediately before responding; otherwise it answers `503`.
3. **Every answer names the identity that produced it.** The API reads the host status, requires
   the reported load to match the active manifest (snapshot, generation marker, import instant),
   sends the query, requires the answer's load identity, generation and snapshot headers to equal
   that load, reads the host status again and requires the same load, and re-reads the full active
   pointer — including `activatedAt` — and the manifest identity.

A stale answer would need a different generation to answer under the identity checked before the
query. Identities are never reused, so any restart or reload between the checks is visible. A
pointer change between the checks is visible because every pointer field is compared, and
`activatedAt` changes on every activation, so an A → B → A flip is visible even though the same
slot serves before and after. Any mismatch returns a typed, retryable `503`.

The adversarial tests exercise host restart, rapid A → B → A, slot reload, connection reuse, a
wrong generation behind the correct slot, and activation and rollback during an in-flight request,
all with the fence at zero. Stale answers observed: zero.

## Consequences

- Up to four copies of a search database on disk at rest — one sealed per slot and one working
  copy per host — and one more on a host while it replaces its copy. Hosts preflight free space
  with the current copy in place and report `insufficient_space` instead of destroying it.
- One Java runtime per slot with search.
- The database builder and its GPL-licensed dependencies stay in a local-only provisioning image
  that is never started by Compose and never published.
- Local, non-container development runs one real engine at a time per machine; the engine
  stand-in used by the host and guard tests has no such limit.
