# Provisioning tests

`pnpm test:provisioning` exercises the real snapshot pipeline with the synthetic tile builder, so
it needs no download, no external tool and no network: preparation into the inactive slot, a
genuine PMTiles archive of decodable vector tiles, manifest provenance and per-artifact checksums,
validation gating activation, atomic activation, rollback, and the guarantee that a failed
preparation changes neither the active pointer nor the inactive slot.

`tile-tool.test.ts` covers the external tile tool's contract by asserting the exact command line
and its pinned image digest. The tool is provisioning-only and is not installed here, so its
invocation is verified rather than executed.
