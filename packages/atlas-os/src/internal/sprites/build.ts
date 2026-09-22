import type { RgbaImage } from './png.js';
import { encodePng } from './png.js';

export interface SpriteIconDefinition {
  readonly name: string;
  /** Radius in logical pixels; the icon box is `2 * radius` on each side. */
  readonly radius: number;
  readonly fill: readonly [number, number, number, number];
  readonly stroke: readonly [number, number, number, number];
  readonly strokeWidth: number;
}

export interface SpriteIndexEntry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly sdf: boolean;
}

export interface SpriteSheet {
  readonly index: Readonly<Record<string, SpriteIndexEntry>>;
  readonly png: Uint8Array;
}

/**
 * The icon set the basemap style needs. Kept deliberately small: M1 renders populated places,
 * not a full point-of-interest catalogue.
 */
export const BASEMAP_ICONS: readonly SpriteIconDefinition[] = [
  {
    fill: [233, 246, 240, 255],
    name: 'place-dot',
    radius: 4,
    stroke: [23, 58, 47, 255],
    strokeWidth: 1.5,
  },
  {
    fill: [114, 230, 185, 255],
    name: 'place-dot-major',
    radius: 5,
    stroke: [7, 19, 15, 255],
    strokeWidth: 1.5,
  },
];

function drawCircle(
  image: RgbaImage,
  originX: number,
  originY: number,
  icon: SpriteIconDefinition,
  pixelRatio: number,
): void {
  const radius = icon.radius * pixelRatio;
  const strokeWidth = icon.strokeWidth * pixelRatio;
  const size = Math.round(radius * 2);
  const centre = size / 2;

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const dx = column + 0.5 - centre;
      const dy = row + 0.5 - centre;
      const distance = Math.hypot(dx, dy);
      const outer = radius - 0.5;
      const inner = outer - strokeWidth;
      // Antialias the rim over one pixel so the icon does not look stepped at 1x.
      const coverage = Math.min(1, Math.max(0, outer - distance + 0.5));
      if (coverage <= 0) continue;
      const colour = distance > inner ? icon.stroke : icon.fill;
      const offset = ((originY + row) * image.width + originX + column) * 4;
      image.data[offset] = colour[0];
      image.data[offset + 1] = colour[1];
      image.data[offset + 2] = colour[2];
      image.data[offset + 3] = Math.round(colour[3] * coverage);
    }
  }
}

/**
 * Packs the icons into a single horizontal strip and produces the paired index document.
 * The layout is deterministic, so regenerating a snapshot yields identical bytes.
 */
export function buildSpriteSheet(
  icons: readonly SpriteIconDefinition[],
  pixelRatio: number,
): SpriteSheet {
  const sizes = icons.map((icon) => Math.round(icon.radius * 2 * pixelRatio));
  const width = sizes.reduce((sum, size) => sum + size, 0);
  const height = Math.max(...sizes);
  const image: RgbaImage = { data: new Uint8Array(width * height * 4), height, width };

  const index: Record<string, SpriteIndexEntry> = {};
  let cursor = 0;
  for (const [position, icon] of icons.entries()) {
    const size = sizes[position]!;
    drawCircle(image, cursor, 0, icon, pixelRatio);
    index[icon.name] = {
      height: size,
      pixelRatio,
      sdf: false,
      width: size,
      x: cursor,
      y: 0,
    };
    cursor += size;
  }

  return { index, png: encodePng(image) };
}
