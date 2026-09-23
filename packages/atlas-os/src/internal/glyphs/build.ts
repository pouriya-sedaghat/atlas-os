import type { Font, FontCollection } from 'fontkit';
import { openSync } from 'fontkit';
import { PbfWriter } from 'pbf';

import { PlatformError } from '../../errors.js';
import type { GlyphBitmap } from './sdf.js';
import { rasterizeGlyph } from './sdf.js';
import { LABEL_RANGES, RANGE_SIZE, rangeName } from './ranges.js';

interface EncodedGlyph extends GlyphBitmap {
  readonly id: number;
}

function writeGlyph(glyph: EncodedGlyph, pbf: PbfWriter): void {
  pbf.writeVarintField(1, glyph.id);
  if (glyph.bitmap.length > 0) pbf.writeBytesField(2, glyph.bitmap);
  pbf.writeVarintField(3, glyph.width);
  pbf.writeVarintField(4, glyph.height);
  pbf.writeSVarintField(5, glyph.left);
  pbf.writeSVarintField(6, glyph.top);
  pbf.writeVarintField(7, glyph.advance);
}

/**
 * Serialises one range in the `glyphs` protocol-buffer schema the renderer fetches:
 * a `glyphs` message holding a single `fontstack` with its name, range label and glyph bitmaps.
 */
export function encodeGlyphRange(
  fontstack: string,
  range: string,
  glyphs: readonly EncodedGlyph[],
): Uint8Array {
  const pbf = new PbfWriter();
  pbf.writeMessage(
    1,
    (
      stack: { name: string; range: string; glyphs: readonly EncodedGlyph[] },
      writer: PbfWriter,
    ) => {
      writer.writeStringField(1, stack.name);
      writer.writeStringField(2, stack.range);
      for (const glyph of stack.glyphs) writer.writeMessage(3, writeGlyph, glyph);
    },
    { glyphs, name: fontstack, range },
  );
  return pbf.finish();
}

function requireFont(path: string): Font {
  const opened: Font | FontCollection = openSync(path);
  if ('fonts' in opened) {
    throw new PlatformError('VALIDATION_FAILED', 'Font collections are not supported.', {
      details: { path },
    });
  }
  return opened;
}

export interface GlyphRangeArtifact {
  readonly glyphCount: number;
  readonly range: string;
  readonly data: Uint8Array;
}

/**
 * Builds the signed-distance-field glyph ranges for one font, so labels render from local
 * resources with no font service and no network access at map load time.
 */
export function buildGlyphRanges(
  fontPath: string,
  fontstack: string,
  options: { readonly ranges?: readonly number[] } = {},
): readonly GlyphRangeArtifact[] {
  const font = requireFont(fontPath);
  const ranges = options.ranges ?? LABEL_RANGES;
  const artifacts: GlyphRangeArtifact[] = [];

  for (const start of ranges) {
    const glyphs: EncodedGlyph[] = [];
    for (let codePoint = start; codePoint < start + RANGE_SIZE; codePoint += 1) {
      if (!font.hasGlyphForCodePoint(codePoint)) continue;
      const glyph = font.glyphForCodePoint(codePoint);
      const bitmap = rasterizeGlyph(glyph.path.commands, {
        advanceWidth: glyph.advanceWidth,
        unitsPerEm: font.unitsPerEm,
      });
      // The renderer addresses glyphs by code point, not by the font's internal glyph id.
      glyphs.push({ ...bitmap, id: codePoint });
    }
    if (glyphs.length === 0) continue;
    const range = rangeName(start);
    artifacts.push({
      data: encodeGlyphRange(fontstack, range, glyphs),
      glyphCount: glyphs.length,
      range,
    });
  }

  if (artifacts.length === 0) {
    throw new PlatformError('VALIDATION_FAILED', 'Font produced no glyph ranges.', {
      details: { fontPath },
    });
  }
  return artifacts;
}
