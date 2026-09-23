import { fromGeojsonVt } from '@maplibre/vt-pbf';
import type { FeatureCollection } from 'geojson';
import { GeoJSONVT } from '@maplibre/geojson-vt';

/** Mapbox Vector Tile specification defaults shared by every tile this package emits. */
export const TILE_EXTENT = 4096;
export const MVT_SPEC_VERSION = 2;

export interface SourceLayerInput {
  readonly name: string;
  readonly features: FeatureCollection;
  readonly maxZoom: number;
  readonly minZoom: number;
}

export interface EncodedTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly data: Uint8Array;
  readonly layers: readonly string[];
}

interface SlicedLayer {
  readonly name: string;
  readonly index: GeoJSONVT;
  readonly maxZoom: number;
  readonly minZoom: number;
}

function sliceLayer(layer: SourceLayerInput, maxZoom: number): SlicedLayer {
  return {
    index: new GeoJSONVT(layer.features, {
      buffer: 64,
      extent: TILE_EXTENT,
      indexMaxZoom: maxZoom,
      maxZoom,
      tolerance: 3,
    }),
    maxZoom: layer.maxZoom,
    minZoom: layer.minZoom,
    name: layer.name,
  };
}

/** Every tile coordinate covering `bounds` at `zoom`, in XYZ (not TMS) order. */
export function tileRange(
  zoom: number,
  bounds: {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
  },
): readonly { readonly z: number; readonly x: number; readonly y: number }[] {
  const scale = 2 ** zoom;
  const clamp = (value: number): number => Math.min(scale - 1, Math.max(0, value));
  const toX = (longitude: number): number => clamp(Math.floor(((longitude + 180) / 360) * scale));
  const toY = (latitude: number): number => {
    const radians = (Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI) / 180;
    const mercator = Math.log(Math.tan(radians) + 1 / Math.cos(radians));
    return clamp(Math.floor(((1 - mercator / Math.PI) / 2) * scale));
  };

  const tiles: { z: number; x: number; y: number }[] = [];
  for (let x = toX(bounds.west); x <= toX(bounds.east); x += 1) {
    // Latitude grows northward while tile rows grow southward, so north maps to the low row.
    for (let y = toY(bounds.north); y <= toY(bounds.south); y += 1) {
      tiles.push({ x, y, z: zoom });
    }
  }
  return tiles;
}

export interface ZoomWindow {
  readonly bounds: {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
  };
  readonly maxZoom: number;
  readonly minZoom: number;
}

/**
 * Slices GeoJSON source layers into a vector tile pyramid.
 *
 * Coverage is described as zoom windows rather than one bounding box so a fixture can hold a
 * whole-region overview at low zoom and a small detailed area at high zoom without generating
 * the tens of thousands of tiles a uniform high-zoom pyramid over a country would need.
 * Each layer additionally declares its own zoom range, mirroring how a real basemap schema
 * introduces detailed layers such as buildings only when they are legible.
 */
export function encodeTilePyramid(
  layers: readonly SourceLayerInput[],
  options: { readonly maxZoom: number; readonly windows: readonly ZoomWindow[] },
): readonly EncodedTile[] {
  const sliced = layers.map((layer) => sliceLayer(layer, options.maxZoom));
  const tiles: EncodedTile[] = [];
  const seen = new Set<string>();

  for (const window of options.windows) {
    for (let zoom = window.minZoom; zoom <= window.maxZoom; zoom += 1) {
      for (const coordinate of tileRange(zoom, window.bounds)) {
        const key = `${coordinate.z}/${coordinate.x}/${coordinate.y}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const present: Record<string, NonNullable<ReturnType<GeoJSONVT['getTile']>>> = {};
        const names: string[] = [];
        for (const layer of sliced) {
          if (zoom < layer.minZoom || zoom > layer.maxZoom) continue;
          const tile = layer.index.getTile(coordinate.z, coordinate.x, coordinate.y);
          if (tile === null || tile.features.length === 0) continue;
          present[layer.name] = tile;
          names.push(layer.name);
        }
        if (names.length === 0) continue;
        tiles.push({
          data: fromGeojsonVt(present, { extent: TILE_EXTENT, version: MVT_SPEC_VERSION }),
          layers: names,
          x: coordinate.x,
          y: coordinate.y,
          z: coordinate.z,
        });
      }
    }
  }
  return tiles;
}
