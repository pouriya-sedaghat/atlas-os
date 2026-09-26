# Data lifecycle

No dataset is committed to this repository, and none is downloaded at runtime. A basemap and its
search database exist on a host only after an operator provisions them.

For production, the raw regional OpenStreetMap extract is the primary input shared by the basemap
and search: search is built from exactly the same file, checked by digest. The basemap additionally
needs the M1 reference-feature, coastline and lake inputs; search needs nothing else. No command
downloads any of these; operators obtain them through their own approved channel.

## Storage layout

```text
data/
├── active.json          pointer to the snapshot that is serving
├── slots/
│   ├── blue/
│   │   ├── manifest.json
│   │   ├── basemap/
│   │   │   ├── basemap.pmtiles
│   │   │   ├── style.json
│   │   │   ├── sprite.json, sprite.png, sprite@2x.json, sprite@2x.png
│   │   │   └── glyphs/<fontstack>/<range>.pbf
│   │   └── search/engine/  sealed search database (schema-2 snapshots only)
│   └── green/           same shape
├── tmp/                 staging directories for in-progress preparations
└── locks/               the exclusive provisioning lock
```

Everything under `data/` is ignored by Git.

A search host never writes to a slot. It copies its slot's sealed database into its own named
volume (`search-blue-work`, `search-green-work`), verifies the copy against the tree digest, and
runs the engine from the copy. When its slot changes, the host closes its gate at once, so the old
generation is never served again, but keeps the old engine and its copy while it builds and
verifies the replacement beside them. Only one engine can run per host, so the switch happens at a
single point: once the verified replacement is still the slot's generation, the old engine stops,
its copy is removed, and the replacement starts. If the replacement fails, the old copy is kept
intact and the new generation is reported unavailable; should the slot show the old generation
again, the running engine is verified again and reopened under a new identity. A slot that shows
no search at all closes the gate at once too, but because promotion passes through an empty slot
for a moment, the old engine and copy are removed only if the slot is still without search one
retry interval (`ATLAS_SEARCH_HOST_RETRY_MS`) later.

A host therefore needs free space for two copies of its slot's search database while it replaces
one, plus its reserve. It measures that with the current copy still on disk, uses a copy-on-write
clone where the filesystem supports one, and reports `insufficient_space` instead of destroying
the current copy when a full copy would not fit; freeing space, or restarting the host, which
discards every working copy, lets it continue. On a host with search in both slots, disk holds up
to four copies of a search database at rest — one sealed per slot and one working copy per host —
and one more on a host while it replaces its copy.

## Blue/green model

The active slot keeps serving while a preparation writes elsewhere. Concretely:

1. **Lock.** An exclusive lock file is created with `wx`. A second preparation or activation fails
   immediately with a conflict naming the process that holds it, rather than interleaving.
2. **Stage.** Artifacts are generated into a fresh directory under `data/tmp/`. Nothing in a slot
   is touched.
3. **Validate inputs.** Every operator-supplied input the selected layers require is resolved,
   confirmed to be a readable non-empty file, and hashed. A preparation missing one is refused
   before any tool starts, so an incomplete basemap is never produced.
4. **Checksum.** A SHA-256 is recorded for every artifact: the archive, the style document, both
   sprite pairs, and every glyph range. Each input's name, file name, size, SHA-256 and timestamp
   are recorded too — never its absolute host path.
5. **Search, when selected.** From the same extract: the database export, post-processing,
   engine import and sealing, all inside staging. The extract is then hashed again: if it is not
   the exact bytes the basemap build hashed, the preparation is refused. The real engine then
   starts from a disposable copy of the sealed database, proves its generation, and records the
   probe questions it answers; the engine host asks them again on every load. The manifest becomes
   schema 2 and records the source digest, the post-processed dump digest and counts, tool
   identities, generation marker, import instant, per-file checksums, tree digest, attribution and
   probes.
6. **Validate in staging.** The full validation below runs against the staged tree. A preparation
   that fails validation is discarded and never reaches a slot.
7. **Promote.** The staged directory is renamed over the _inactive_ slot. The store refuses to
   promote into the active slot, so a caller error cannot destroy the serving snapshot.
8. **Activate.** Validation runs again, then `active.json` is replaced by writing a temporary file
   and renaming it. A rename within one filesystem is atomic, so a reader sees either the old
   pointer or the complete new one — never a truncated one.
9. **Roll back.** The new pointer records the previous snapshot and slot. `rollback` re-validates
   that snapshot and restores the pointer.

The slot manifests record `activation` as it stood when the snapshot was written. `active.json` is
the authoritative record of what is serving; a slot manifest is never rewritten to flip it, which
is what keeps "never modify the active slot in place" literally true.

## What validation checks

`atlas-os update validate <snapshot-id>` reports each check individually, and activation refuses
unless every one passes:

| Check               | What it proves                                                                         |
| ------------------- | -------------------------------------------------------------------------------------- |
| `manifest`          | The manifest parses against the strict schema, rejecting unknown fields                |
| `region`            | The snapshot was built for the region this host is configured for                      |
| `basemap_component` | A basemap component is declared with a tile count and zoom range                       |
| `checksums`         | Every recorded artifact exists and still hashes to its recorded SHA-256                |
| `archive`           | The archive parses, carries **vector** tiles, and agrees with the manifest             |
| `style`             | The style draws only layers the archive provides, and references no non-local resource |
| `glyphs`            | Every declared glyph range is present                                                  |
| `sprites`           | The sprite index and image exist at both pixel ratios                                  |
| `label_languages`   | At least one label language is declared                                                |
| `bounds`            | Geographic bounds have increasing axes                                                 |

A schema-2 snapshot is additionally checked for what its search component claims:

| Check                | What it proves                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `search_component`   | Search is marked ready, the canary lies outside the region, reverse probes inside it, search probes are canonical     |
| `search_provenance`  | Search came from the same extract as the basemap and carries its attribution; synthetic search says so                |
| `search_generation`  | The generation marker recomputes from the snapshot, source, dump and import instant; the import precedes the snapshot |
| `search_engine_tree` | The sealed tree matches its digest, file set, sizes and hashes; no link, run-time output, host path or wrong mode     |

A snapshot that is incomplete, corrupt, or built for a different region cannot be activated.

## Activating a snapshot with search

Activation normally waits for search. `atlas-os update activate <snapshot-id>` asks the local API
whether the standby search host has loaded exactly that snapshot and generation under a fresh load
identity, and refuses with `SEARCH_NOT_READY` (exit code 2, retryable) if it has not, or if the API
cannot be reached. Retry once the host reports ready.

`--activate-while-search-starting` activates anyway. The basemap switches at once; search reports
`starting` until its host has loaded and proved the new generation, and never answers from the
previous one in the meantime. The developer fixture launcher uses it because no engine host is
running while it prepares.

Basemap-only snapshots activate exactly as in M1, with no search check.

## Rolling back and downgrading

`atlas-os rollback` restores the previous pointer after re-validating the previous snapshot,
whichever schema it has. The host for that slot is usually still serving it, so search is
available again immediately; otherwise it reloads that slot from its sealed database, with no
rebuild.

Slots are never migrated in place, and the active pointer keeps its M1 schema. To return to M1
software, first activate a basemap-only (schema 1) snapshot, then stop the M2 services; M1 cannot
read schema-2 manifests.

## Operator workflow

Provisioning is explicit and operator initiated. There is no scheduler, no downloader and no
replication. The commands are in [development](development.md).

## Destructive behaviour

There is no garbage collection. The only destructive step on the dataset is replacing the inactive
slot during promotion, which is inherent to the blue/green model and never touches the active
snapshot. A search host deletes only its own working copies, and only once their engine has
stopped: the current copy is kept until a verified replacement is ready to start. Two
slots means one rollback step is always available: after activating a new snapshot, the one it
replaced remains on disk.

## Adding real data

Any real dataset must be recorded in [`DATA_SOURCES.md`](../DATA_SOURCES.md) with its licence,
attribution, provenance and checksums before it is used. Raw extracts and generated archives live
under `data/` and are never committed.
