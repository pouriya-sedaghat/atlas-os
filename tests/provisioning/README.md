# Provisioning tests

`pnpm test:provisioning` exercises the real snapshot pipeline with the synthetic tile builder, so
it needs no download, no external tool and no network: preparation into the inactive slot, a
genuine PMTiles archive of decodable vector tiles, manifest provenance and per-artifact checksums,
validation gating activation, atomic activation, rollback, and the guarantee that a failed
preparation changes neither the active pointer nor the inactive slot.

`tile-tool.test.ts` covers the external tile tool's contract by asserting the exact command line
and its pinned image digest. The tool is provisioning-only and is not installed here, so its
invocation is verified rather than executed.

`search-lifecycle.test.ts` runs the search half of a preparation through the same provisioner:
post-processing, the canary, import, sealing, probe selection, the schema-2 manifest, validation,
promotion, activation, rollback across schema versions, a host serving the result, the same-extract
rule and its re-hash, unique import instants, and cleanup after failure. The import and the engine
are stand-ins; `pnpm test:engine` runs the same path with the real ones. `search-validation.test.ts`
covers every semantic schema-2 check and the tampering each one catches.
