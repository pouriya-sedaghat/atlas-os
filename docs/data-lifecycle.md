# Data lifecycle

No real data is imported in M0. The repository contains only a validated fixture manifest. Runtime
state belongs under ignored `data/` paths and must not be committed.

## Future blue/green model

```text
data/
├── active.json
├── slots/
│   ├── blue/
│   └── green/
└── downloads/
```

The active slot continues serving while the updater prepares the inactive slot. Preparation and
validation do not mutate the active snapshot. After every component passes validation, activation
will atomically replace the small `active.json` pointer. The previous known-good slot remains
available for rollback.

A manifest records:

- snapshot, source, and region identity;
- source and creation timestamps;
- schema and artifact versions;
- checksums;
- component readiness;
- validation and activation states.

`packages/atlas-os/src/snapshot.ts` implements the strict M0 manifest schema. Unknown fields,
invalid IDs, malformed timestamps, and non-SHA-256 checksums are rejected. M0 intentionally does
not download, prepare, activate, delete, or roll back real artifacts.

Future data additions must update `DATA_SOURCES.md`, include license and attribution review, and
never place generated archives or graphs in Git.
