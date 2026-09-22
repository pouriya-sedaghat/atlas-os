export const RANGE_SIZE = 256;
export const MAX_RANGE_START = 65_280;

/** Identifier a renderer substitutes for `{range}`, for example `1536-1791`. */
export function rangeName(start: number): string {
  return `${start}-${start + RANGE_SIZE - 1}`;
}

export function rangeStartForCodePoint(codePoint: number): number {
  return Math.floor(codePoint / RANGE_SIZE) * RANGE_SIZE;
}

const rangePattern = /^(\d{1,5})-(\d{1,5})$/;

/** Parses a `{range}` path segment, rejecting anything outside the renderer's addressable set. */
export function parseRangeName(value: string): number | undefined {
  const match = rangePattern.exec(value);
  if (match === null) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start % RANGE_SIZE !== 0) return undefined;
  if (end !== start + RANGE_SIZE - 1) return undefined;
  if (start < 0 || start > MAX_RANGE_START) return undefined;
  return start;
}

/**
 * Ranges required for Persian and English labels.
 *
 * Latin covers English names and digits. The Arabic block covers Persian text as it is stored in
 * OpenStreetMap, and the two Arabic Presentation Forms blocks cover the contextual shapes the
 * right-to-left text plugin produces before the renderer looks a glyph up.
 */
export const LABEL_RANGES: readonly number[] = [
  0, // U+0000-U+00FF Basic Latin and Latin-1 Supplement
  1_536, // U+0600-U+06FF Arabic
  64_256, // U+FB00-U+FBFF Alphabetic Presentation Forms and Arabic Presentation Forms-A
  64_512, // U+FC00-U+FCFF Arabic Presentation Forms-A
  64_768, // U+FD00-U+FDFF Arabic Presentation Forms-A
  65_024, // U+FE00-U+FEFF Arabic Presentation Forms-B
];
