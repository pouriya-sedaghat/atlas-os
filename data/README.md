# Runtime data

This directory holds local runtime state and is ignored by Git apart from this file and the
`.gitignore` beside it.

```text
data/
├── active.json   pointer to the snapshot that is serving
├── slots/        blue and green snapshot slots
├── tmp/          staging directories for in-progress preparations
└── locks/        the exclusive provisioning lock
```

No dataset is committed here, and nothing is downloaded at runtime. An operator provisions a
basemap explicitly; see [data lifecycle](../docs/data-lifecycle.md).

A country-scale archive is large. Point `ATLAS_DATA_ROOT` at storage sized for two slots plus
staging — roughly three times the archive size.
