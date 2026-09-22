import { PbfReader } from 'pbf';

/**
 * Minimal Mapbox Vector Tile reader.
 *
 * Only the structure needed to prove a tile is a well-formed vector tile is decoded: the layers
 * it declares, their spec version and extent, and how many features each holds. Geometry is not
 * decoded, because validation needs to know the tile parses and carries the declared layers, not
 * what the geometry says.
 */
export interface DecodedTileLayer {
  readonly extent: number;
  readonly featureCount: number;
  readonly name: string;
  readonly version: number;
}

const TILE_LAYER_FIELD = 3;
const LAYER_VERSION_FIELD = 15;
const LAYER_NAME_FIELD = 1;
const LAYER_FEATURE_FIELD = 2;
const LAYER_EXTENT_FIELD = 5;

interface MutableLayer {
  extent: number;
  featureCount: number;
  name: string;
  version: number;
}

function readLayer(tag: number, layer: MutableLayer, pbf: PbfReader): void {
  if (tag === LAYER_VERSION_FIELD) layer.version = pbf.readVarint();
  else if (tag === LAYER_NAME_FIELD) layer.name = pbf.readString();
  else if (tag === LAYER_FEATURE_FIELD) {
    layer.featureCount += 1;
    pbf.skip(pbf.type);
  } else if (tag === LAYER_EXTENT_FIELD) layer.extent = pbf.readVarint();
  else pbf.skip(pbf.type);
}

function readTile(tag: number, layers: MutableLayer[], pbf: PbfReader): void {
  if (tag !== TILE_LAYER_FIELD) {
    pbf.skip(pbf.type);
    return;
  }
  layers.push(pbf.readMessage(readLayer, { extent: 4096, featureCount: 0, name: '', version: 1 }));
}

/** Throws if `bytes` is not a parseable vector tile. */
export function decodeTileLayers(bytes: Uint8Array): readonly DecodedTileLayer[] {
  const layers = new PbfReader(bytes).readFields(readTile, [] as MutableLayer[]);
  return layers.map((layer) => ({
    extent: layer.extent,
    featureCount: layer.featureCount,
    name: layer.name,
    version: layer.version,
  }));
}
