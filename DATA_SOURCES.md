# Data sources

This repository contains **no map dataset**. It contains no OpenStreetMap extract, no generated
tile archive, and no map of any territory. A basemap exists on a host only after an operator
provisions one from data they supply.

## Currently included data-bearing files

| File                                 | What it is                                                      | Licence |
| ------------------------------------ | --------------------------------------------------------------- | ------- |
| `assets/fonts/Vazirmatn-Regular.ttf` | A font, used to generate label glyphs. Not map data.            | OFL-1.1 |
| `config/regions/iran.yaml`           | A bounding box and label languages. Metadata only, no geometry. | —       |

The automated tests use a **synthetic fixture** generated in code by
`packages/atlas-os/src/internal/builders/fixture-features.ts`. Its geometry is invented and
deliberately coarse: a handful of quadrilaterals, lines and labelled points placed within the
configured bounds so the pipeline, archive format, style, glyph coverage and renderer are all
exercised. It is a test scaffold and must never be presented as a map of Iran or anywhere else.
It is generated at test time and never committed.

## Production data

The production and default region is **Iran**. A production basemap is built from **several**
operator-supplied inputs, not only the OpenStreetMap extract. The operator obtains each through
their own approved channel; this software never downloads any of them, and none is committed.

| Input role           | What it is                                         | Typical licence                 |
| -------------------- | -------------------------------------------------- | ------------------------------- |
| `region-extract`     | Regional OpenStreetMap extract (`.osm.pbf`)        | ODbL 1.0                        |
| `reference-features` | Small-scale reference geometry for low-zoom layers | Public domain (verify upstream) |
| `coastline-polygons` | Pre-processed coastline and ocean polygons         | ODbL 1.0 (derived from OSM)     |
| `lake-centerlines`   | Centreline geometry for large water labels         | Verify upstream                 |

Only the first three are required by the layers this basemap draws; the fourth is required only if
a water-label layer is added. A preparation that is missing a required input is refused rather
than producing a basemap quietly missing that layer's data.

Confirm each input's licence and attribution terms with its publisher before release, and record
the result in the table below. This note is not legal advice.

## Record for every source

Complete this table before a dataset is used in a deployment.

| Field            | Required information                                     |
| ---------------- | -------------------------------------------------------- |
| Source name      | Human-readable dataset name                              |
| Publisher        | Organization or person publishing the data               |
| Source URL       | Canonical acquisition page, not a transient download URL |
| Region           | Geographic scope                                         |
| Retrieved at     | UTC timestamp                                            |
| Source timestamp | Publisher's data timestamp                               |
| License          | Exact license name and version                           |
| Attribution      | Text required in the product                             |
| Processing       | Reproducible transformations and tool versions           |
| Snapshot ID      | Corresponding local manifest ID                          |
| Checksums        | SHA-256 values for acquired inputs                       |
| Approval         | Reviewer and approval reference                          |

The snapshot manifest already records the source name and timestamp, the region, the tool and
schema versions, and a SHA-256 for every generated artifact, so most of this table can be filled
from `data/slots/<slot>/manifest.json` after a preparation.

## Attribution

A production basemap built with the pinned tooling carries the attribution its tile schema
declares, which credits **both** projects:

```text
© OpenMapTiles   https://www.openmaptiles.org/
© OpenStreetMap contributors   https://www.openstreetmap.org/copyright
```

The generated style document carries this verbatim as its source attribution; the Web application
renders the attribution control expanded, so the credit is visible rather than hidden behind a
control the viewer must open. Snapshot validation refuses a snapshot whose style does not carry
the attribution its manifest records, and whose archive does not declare the same attribution.

The links are navigational. Nothing fetches them while the map renders, which is why the offline
guarantee is expressed over fetched resources rather than over every URL in the document.

The synthetic test fixture carries a different attribution, because it contains no OpenStreetMap
data at all: crediting those projects for invented geometry would itself be a licensing error. It
says plainly that it is not a map of any territory.

Confirm the current attribution and licence requirements with each publisher before release; this
note is not legal advice.

Do not add data until licensing, attribution, storage and update policy have been reviewed. Large
raw or generated artifacts belong in ignored runtime storage under `data/`, never in Git.
