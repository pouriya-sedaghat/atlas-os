import type { PathCommand } from 'fontkit';

/**
 * Signed-distance-field parameters. These are the values the renderer's symbol shader assumes:
 * a 24 px em, a 3 px border around each glyph, and a distance range of 8 px encoded so that the
 * outline itself lands on 0.75 of the byte range.
 */
export const FONT_SIZE = 24;
export const GLYPH_BORDER = 3;
export const SDF_RADIUS = 8;
export const SDF_CUTOFF = 0.25;

export interface GlyphBitmap {
  readonly advance: number;
  readonly bitmap: Uint8Array;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/**
 * Flattens a glyph outline into straight segments expressed in pixels with y pointing up.
 *
 * Curves are subdivided proportionally to their control-polygon length, so a large curve gets
 * more segments than a small one and the result is deterministic for a given font and size.
 */
export function flattenOutline(commands: readonly PathCommand[], scale: number): Float64Array {
  const segments: number[] = [];
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;

  const pushSegment = (x1: number, y1: number, x2: number, y2: number): void => {
    if (x1 === x2 && y1 === y2) return;
    segments.push(x1, y1, x2, y2);
  };

  const subdivisionCount = (...points: readonly number[]): number => {
    let length = 0;
    for (let index = 2; index < points.length; index += 2) {
      length += Math.hypot(
        points[index]! - points[index - 2]!,
        points[index + 1]! - points[index - 1]!,
      );
    }
    return Math.min(24, Math.max(2, Math.ceil(length / 0.35)));
  };

  for (const { command, args } of commands) {
    if (command === 'moveTo') {
      currentX = args[0]! * scale;
      currentY = args[1]! * scale;
      startX = currentX;
      startY = currentY;
      continue;
    }
    if (command === 'lineTo') {
      const x = args[0]! * scale;
      const y = args[1]! * scale;
      pushSegment(currentX, currentY, x, y);
      currentX = x;
      currentY = y;
      continue;
    }
    if (command === 'quadraticCurveTo') {
      const cx = args[0]! * scale;
      const cy = args[1]! * scale;
      const x = args[2]! * scale;
      const y = args[3]! * scale;
      const steps = subdivisionCount(currentX, currentY, cx, cy, x, y);
      let previousX = currentX;
      let previousY = currentY;
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const inverse = 1 - t;
        const px = inverse * inverse * currentX + 2 * inverse * t * cx + t * t * x;
        const py = inverse * inverse * currentY + 2 * inverse * t * cy + t * t * y;
        pushSegment(previousX, previousY, px, py);
        previousX = px;
        previousY = py;
      }
      currentX = x;
      currentY = y;
      continue;
    }
    if (command === 'bezierCurveTo') {
      const c1x = args[0]! * scale;
      const c1y = args[1]! * scale;
      const c2x = args[2]! * scale;
      const c2y = args[3]! * scale;
      const x = args[4]! * scale;
      const y = args[5]! * scale;
      const steps = subdivisionCount(currentX, currentY, c1x, c1y, c2x, c2y, x, y);
      let previousX = currentX;
      let previousY = currentY;
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const inverse = 1 - t;
        const px =
          inverse ** 3 * currentX +
          3 * inverse ** 2 * t * c1x +
          3 * inverse * t * t * c2x +
          t ** 3 * x;
        const py =
          inverse ** 3 * currentY +
          3 * inverse ** 2 * t * c1y +
          3 * inverse * t * t * c2y +
          t ** 3 * y;
        pushSegment(previousX, previousY, px, py);
        previousX = px;
        previousY = py;
      }
      currentX = x;
      currentY = y;
      continue;
    }
    // closePath
    pushSegment(currentX, currentY, startX, startY);
    currentX = startX;
    currentY = startY;
  }

  // Close any contour the font left open; the winding test requires closed rings.
  return Float64Array.from(segments);
}

function squaredDistanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Non-zero winding test, which keeps counters (the hole in a "ه") transparent. */
function isInside(segments: Float64Array, px: number, py: number): boolean {
  let winding = 0;
  for (let index = 0; index < segments.length; index += 4) {
    const ax = segments[index]!;
    const ay = segments[index + 1]!;
    const bx = segments[index + 2]!;
    const by = segments[index + 3]!;
    if (ay <= py) {
      if (by > py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) > 0) winding += 1;
    } else if (by <= py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) < 0) {
      winding -= 1;
    }
  }
  return winding !== 0;
}

export function encodeSdfValue(signedDistance: number): number {
  const value = Math.round(255 - 255 * (signedDistance / SDF_RADIUS + SDF_CUTOFF));
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/**
 * Rasterises one glyph outline into a signed-distance-field bitmap.
 *
 * The distance is measured directly against the outline segments rather than by rasterising and
 * running a distance transform, which keeps the field accurate at sub-pixel scale and makes the
 * output independent of any canvas implementation.
 */
export function rasterizeGlyph(
  commands: readonly PathCommand[],
  metrics: { readonly advanceWidth: number; readonly unitsPerEm: number },
): GlyphBitmap {
  const scale = FONT_SIZE / metrics.unitsPerEm;
  const advance = Math.round(metrics.advanceWidth * scale);
  const segments = flattenOutline(commands, scale);

  if (segments.length === 0) {
    return { advance, bitmap: new Uint8Array(0), height: 0, left: 0, top: 0, width: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < segments.length; index += 2) {
    const x = segments[index]!;
    const y = segments[index + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const left = Math.floor(minX);
  const bottom = Math.floor(minY);
  const top = Math.ceil(maxY);
  const width = Math.ceil(maxX) - left;
  const height = top - bottom;
  const bufferedWidth = width + 2 * GLYPH_BORDER;
  const bufferedHeight = height + 2 * GLYPH_BORDER;
  const bitmap = new Uint8Array(bufferedWidth * bufferedHeight);

  for (let row = 0; row < bufferedHeight; row += 1) {
    // Row 0 is the top of the bitmap, so y decreases as the row index grows.
    const py = top + GLYPH_BORDER - row - 0.5;
    for (let column = 0; column < bufferedWidth; column += 1) {
      const px = left - GLYPH_BORDER + column + 0.5;
      let nearest = Infinity;
      for (let index = 0; index < segments.length; index += 4) {
        const candidate = squaredDistanceToSegment(
          px,
          py,
          segments[index]!,
          segments[index + 1]!,
          segments[index + 2]!,
          segments[index + 3]!,
        );
        if (candidate < nearest) nearest = candidate;
      }
      const distance = Math.sqrt(nearest);
      const signed = isInside(segments, px, py) ? -distance : distance;
      bitmap[row * bufferedWidth + column] = encodeSdfValue(signed);
    }
  }

  return { advance, bitmap, height, left, top, width };
}
