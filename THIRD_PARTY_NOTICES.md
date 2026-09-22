# Third-party notices

The following direct runtime and development dependencies are used. Their own license texts and
transitive dependency notices remain authoritative in the installed packages and upstream
projects.

## Runtime and build dependencies

| Dependency                   |          Version | Purpose                                       | License      |
| ---------------------------- | ---------------: | --------------------------------------------- | ------------ |
| Fastify                      |            5.6.0 | Local HTTP API                                | MIT          |
| React                        |           19.1.1 | Local Web UI                                  | MIT          |
| React DOM                    |           19.1.1 | Web DOM rendering                             | MIT          |
| Zod                          |            4.1.5 | Runtime schema and configuration validation   | MIT          |
| `yaml`                       |            2.9.1 | Region descriptor parsing                     | ISC          |
| MapLibre GL JS               |           6.10.0 | Browser map rendering                         | BSD-3-Clause |
| `pmtiles`                    |            4.5.0 | Archive reading and renderer protocol adapter | BSD-3-Clause |
| `@mapbox/mapbox-gl-rtl-text` |            0.4.0 | Right-to-left text shaping, served locally    | BSD-2-Clause |
| `@maplibre/geojson-vt`       |            6.1.1 | Tile slicing for the synthetic fixture        | ISC          |
| `@maplibre/vt-pbf`           |            4.3.2 | Vector tile serialisation                     | MIT          |
| `pbf`                        |            5.1.2 | Protocol buffer encoding for glyph ranges     | BSD-3-Clause |
| `fontkit`                    |            2.0.4 | Font parsing for glyph generation             | MIT          |
| Vite                         |            7.1.5 | Web build and development server              | MIT          |
| Vitest                       |            3.2.4 | Test runner                                   | MIT          |
| Playwright Test              |           1.63.0 | Browser end-to-end tests                      | Apache-2.0   |
| `@mapbox/vector-tile`        |            3.0.0 | Vector tile decoding in tests                 | BSD-3-Clause |
| TypeScript                   |            5.9.2 | Type checking and compilation                 | Apache-2.0   |
| ESLint                       |           9.35.0 | Static analysis                               | MIT          |
| `@eslint/js`                 |           9.35.0 | ESLint JavaScript rules                       | MIT          |
| typescript-eslint            |           8.43.0 | TypeScript lint integration                   | BSD-2-Clause |
| Prettier                     |            3.6.2 | Formatting                                    | MIT          |
| tsx                          |           4.20.5 | TypeScript development runner                 | MIT          |
| globals                      |           16.3.0 | ESLint environment globals                    | MIT          |
| `@vitejs/plugin-react`       |            5.0.2 | React transform for Vite                      | MIT          |
| React type definitions       | 19.1.12 / 19.1.9 | Type declarations                             | MIT          |
| Node.js type definitions     |          22.20.4 | Type declarations                             | MIT          |
| GeoJSON type definitions     |        7946.0.16 | Type declarations                             | MIT          |
| fontkit type definitions     |            2.0.9 | Type declarations                             | MIT          |

## Provisioning tooling

Planetiler 0.10.2 (Apache-2.0) generates vector tiles from operator-supplied inputs. It is **not**
a dependency of this repository and is not installed by it. It is referenced only as a pinned
container image,
`ghcr.io/onthegomap/planetiler:0.10.2@sha256:cf32202dbc001a9ab4bc11534b642b13de3798179817da8558e567a3d13dd403`,
or as an operator-supplied local archive, and is invoked only during explicit provisioning. It is
never present in a request-serving image.

Its bundled profile implements the **OpenMapTiles** tile schema, version 3.16.0, which is a
separate work from the tool itself: `org.openmaptiles:planetiler-openmaptiles`, pinned by the
tool's own v0.10.2 tag to commit `91516fdf477915b1a985015811049b9b96c7f87e`. Confirm its licence
terms before distributing a derived tileset.

That schema **requires visible attribution for both OpenMapTiles and OpenStreetMap
contributors**, as hyperlinks. A basemap produced with it carries the schema's own attribution
string verbatim; see [DATA_SOURCES.md](DATA_SOURCES.md).

The schema's layers also consume small-scale reference geometry and pre-processed coastline
polygons in addition to the OpenStreetMap extract. Those are operator-supplied data, each with its
own licence, and none of them is redistributed here.

## Bundled font

`assets/fonts/Vazirmatn-Regular.ttf` — Vazirmatn 33.0.3, Copyright 2015 The Vazirmatn Project
Authors (<https://github.com/rastikerdar/vazirmatn>), licensed under the **SIL Open Font License,
Version 1.1**. The full licence text is reproduced at `assets/fonts/OFL.txt`, and provenance and
checksums are recorded in `assets/fonts/README.md`. The OFL permits redistribution of the font
software provided this notice and the licence accompany it.

## Container foundations

- Node.js `22.14.0-alpine3.21` pinned to manifest digest
  `sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944` (Node.js is MIT; the
  Alpine image includes separately licensed system packages).
- NGINX Unprivileged `1.27.5-alpine` pinned to manifest digest
  `sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0` (NGINX uses the
  BSD-2-Clause license; the image includes separately licensed Alpine packages).

## Map data

No map data is included in this repository. Data an operator supplies carries its own licence and
attribution obligations; see [DATA_SOURCES.md](DATA_SOURCES.md).

This repository has no selected project-level open-source license; that remains a governance
decision.
