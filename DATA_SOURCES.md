# Data sources

M0 imports no dataset. This file is a template for future approved snapshots.

For every source, record:

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

Do not add data until licensing, attribution, storage, and update policy have been reviewed. Large
raw or generated artifacts belong in ignored runtime storage, never in Git.
