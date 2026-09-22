# Data lifecycle

No dataset is committed to this repository, and none is downloaded at runtime. A basemap exists on
a host only after an operator provisions one.

## Storage layout

```text
data/
├── active.json          pointer to the snapshot that is serving
├── slots/
│   ├── blue/
│   │   ├── manifest.json
│   │   └── basemap/
│   │       ├── basemap.pmtiles
│   │       ├── style.json
│   │       ├── sprite.json, sprite.png, sprite@2x.json, sprite@2x.png
│   │       └── glyphs/<fontstack>/<range>.pbf
│   └── green/           same shape
├── tmp/                 staging directories for in-progress preparations
└── locks/               the exclusive provisioning lock
```

Everything under `data/` is ignored by Git.

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
5. **Validate in staging.** The full validation below runs against the staged tree. A preparation
   that fails validation is discarded and never reaches a slot.
6. **Promote.** The staged directory is renamed over the _inactive_ slot. The store refuses to
   promote into the active slot, so a caller error cannot destroy the serving snapshot.
7. **Activate.** Validation runs again, then `active.json` is replaced by writing a temporary file
   and renaming it. A rename within one filesystem is atomic, so a reader sees either the old
   pointer or the complete new one — never a truncated one.
8. **Roll back.** The new pointer records the previous snapshot and slot. `rollback` re-validates
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

A snapshot that is incomplete, corrupt, or built for a different region cannot be activated.

## Operator workflow

Provisioning is explicit and operator initiated. There is no scheduler, no downloader and no
replication. The commands are in [development](development.md).

## Destructive behaviour

M1 performs no garbage collection. The only destructive step is replacing the inactive slot during
promotion, which is inherent to the blue/green model and never touches the active snapshot. Two
slots means one rollback step is always available: after activating a new snapshot, the one it
replaced remains on disk.

## Adding real data

Any real dataset must be recorded in [`DATA_SOURCES.md`](../DATA_SOURCES.md) with its licence,
attribution, provenance and checksums before it is used. Raw extracts and generated archives live
under `data/` and are never committed.
