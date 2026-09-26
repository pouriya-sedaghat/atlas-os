import { PbfWriter } from 'pbf';

/**
 * A minimal, deterministic OpenStreetMap PBF encoder for test fixtures.
 *
 * It writes the published file format directly: an `OSMHeader` block followed by one `OSMData`
 * block holding plain nodes, ways and relations, each group sorted by ID. Blobs are stored raw
 * rather than zlib-compressed, so the output is byte-identical on every platform and zlib version.
 * No network, no external tool.
 */

export type Tags = Readonly<Record<string, string>>;

export interface OsmNode {
  readonly id: number;
  readonly lat: number;
  readonly lon: number;
  readonly tags?: Tags;
}

export interface OsmWay {
  readonly id: number;
  readonly refs: readonly number[];
  readonly tags?: Tags;
}

export interface OsmMember {
  readonly type: 'node' | 'way' | 'relation';
  readonly ref: number;
  readonly role: string;
}

export interface OsmRelation {
  readonly id: number;
  readonly members: readonly OsmMember[];
  readonly tags?: Tags;
}

export interface OsmData {
  readonly nodes: readonly OsmNode[];
  readonly ways: readonly OsmWay[];
  readonly relations: readonly OsmRelation[];
  /** Object and replication timestamp, in whole seconds since the epoch. */
  readonly timestamp: number;
}

const NANO = 1e9;
const GRANULARITY = 100;

class StringTable {
  readonly #index = new Map<string, number>([['', 0]]);
  readonly strings: string[] = [''];

  id(value: string): number {
    let index = this.#index.get(value);
    if (index === undefined) {
      index = this.strings.length;
      this.strings.push(value);
      this.#index.set(value, index);
    }
    return index;
  }
}

function delta(values: readonly number[]): number[] {
  let previous = 0;
  return values.map((value) => {
    const result = value - previous;
    previous = value;
    return result;
  });
}

function toUnits(degrees: number): number {
  return Math.round((degrees * NANO) / GRANULARITY);
}

function writeInfo(timestamp: number, pbf: PbfWriter): void {
  pbf.writeVarintField(1, 1); // version
  pbf.writeVarintField(2, timestamp); // timestamp, in date_granularity (1000 ms) units
  pbf.writeVarintField(3, 1); // changeset
}

function writeTags(tags: Tags | undefined, strings: StringTable, pbf: PbfWriter): void {
  const entries = Object.entries(tags ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  pbf.writePackedVarint(
    2,
    entries.map(([key]) => strings.id(key)),
  );
  pbf.writePackedVarint(
    3,
    entries.map(([, value]) => strings.id(value)),
  );
}

function encodeHeader(data: OsmData): Uint8Array {
  const pbf = new PbfWriter();
  const lats = data.nodes.map((node) => node.lat);
  const lons = data.nodes.map((node) => node.lon);
  pbf.writeMessage(
    1,
    (_: undefined, writer: PbfWriter) => {
      writer.writeSVarintField(1, Math.round(Math.min(...lons) * NANO));
      writer.writeSVarintField(2, Math.round(Math.max(...lons) * NANO));
      writer.writeSVarintField(3, Math.round(Math.max(...lats) * NANO));
      writer.writeSVarintField(4, Math.round(Math.min(...lats) * NANO));
    },
    undefined,
  );
  pbf.writeStringField(4, 'OsmSchema-V0.6');
  pbf.writeStringField(16, 'atlas-os-test-fixture');
  pbf.writeVarintField(32, data.timestamp); // osmosis_replication_timestamp
  return pbf.finish();
}

function encodeData(data: OsmData): Uint8Array {
  const strings = new StringTable();
  const nodes = [...data.nodes].sort((a, b) => a.id - b.id);
  const ways = [...data.ways].sort((a, b) => a.id - b.id);
  const relations = [...data.relations].sort((a, b) => a.id - b.id);

  // Groups are encoded first so every string is registered before the table is written.
  const groups: Uint8Array[] = [];
  const group = (write: (pbf: PbfWriter) => void) => {
    const pbf = new PbfWriter();
    write(pbf);
    groups.push(pbf.finish());
  };

  group((pbf) => {
    for (const node of nodes) {
      pbf.writeMessage(
        1,
        (_: undefined, writer: PbfWriter) => {
          writer.writeSVarintField(1, node.id);
          writeTags(node.tags, strings, writer);
          writer.writeMessage(
            4,
            (__: undefined, info: PbfWriter) => writeInfo(data.timestamp, info),
            undefined,
          );
          writer.writeSVarintField(8, toUnits(node.lat));
          writer.writeSVarintField(9, toUnits(node.lon));
        },
        undefined,
      );
    }
  });
  group((pbf) => {
    for (const way of ways) {
      pbf.writeMessage(
        3,
        (_: undefined, writer: PbfWriter) => {
          writer.writeVarintField(1, way.id);
          writeTags(way.tags, strings, writer);
          writer.writeMessage(
            4,
            (__: undefined, info: PbfWriter) => writeInfo(data.timestamp, info),
            undefined,
          );
          writer.writePackedSVarint(8, delta(way.refs));
        },
        undefined,
      );
    }
  });
  group((pbf) => {
    for (const relation of relations) {
      pbf.writeMessage(
        4,
        (_: undefined, writer: PbfWriter) => {
          writer.writeVarintField(1, relation.id);
          writeTags(relation.tags, strings, writer);
          writer.writeMessage(
            4,
            (__: undefined, info: PbfWriter) => writeInfo(data.timestamp, info),
            undefined,
          );
          writer.writePackedVarint(
            8,
            relation.members.map((member) => strings.id(member.role)),
          );
          writer.writePackedSVarint(9, delta(relation.members.map((member) => member.ref)));
          writer.writePackedVarint(
            10,
            relation.members.map((member) =>
              member.type === 'node' ? 0 : member.type === 'way' ? 1 : 2,
            ),
          );
        },
        undefined,
      );
    }
  });

  const pbf = new PbfWriter();
  pbf.writeMessage(
    1,
    (_: undefined, writer: PbfWriter) => {
      for (const value of strings.strings) writer.writeBytesField(1, Buffer.from(value, 'utf8'));
    },
    undefined,
  );
  for (const encoded of groups) pbf.writeBytesField(2, encoded);
  return pbf.finish();
}

function fileBlock(type: string, payload: Uint8Array): Buffer {
  const blob = new PbfWriter();
  blob.writeBytesField(1, payload); // raw
  blob.writeVarintField(2, payload.length); // raw_size
  const blobBytes = blob.finish();

  const header = new PbfWriter();
  header.writeStringField(1, type);
  header.writeVarintField(3, blobBytes.length);
  const headerBytes = header.finish();

  const length = Buffer.alloc(4);
  length.writeUInt32BE(headerBytes.length);
  return Buffer.concat([length, headerBytes, blobBytes]);
}

export function encodeOsmPbf(data: OsmData): Buffer {
  return Buffer.concat([
    fileBlock('OSMHeader', encodeHeader(data)),
    fileBlock('OSMData', encodeData(data)),
  ]);
}
