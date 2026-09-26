/**
 * Canonical form of Persian and Arabic-script search text.
 *
 * The search engine's analyzers fold only Latin case and diacritics; they treat Arabic and
 * Persian letter variants, Persian and Arabic-Indic digits, harakat and tatweel as different
 * characters. Measured against the pinned engine, apparent matches between those variants came
 * only from typo tolerance and failed at the first letter, for short prefixes and for digits.
 * The same canonical form is therefore applied to user queries and to the search-only name
 * variants written at import time, so both sides meet regardless of how the text was typed or
 * mapped. Displayed names are never canonicalised.
 *
 * The function is pure and idempotent: `canonicalizeSearchText(canonicalizeSearchText(x))`
 * equals `canonicalizeSearchText(x)` for every string.
 */

/** Arabic letters folded onto the Persian letters Iranian data conventionally uses. */
const LETTERS: ReadonlyMap<number, string> = new Map([
  [0x064a, '\u06cc'], // ARABIC LETTER YEH -> ARABIC LETTER FARSI YEH
  [0x0649, '\u06cc'], // ARABIC LETTER ALEF MAKSURA -> ARABIC LETTER FARSI YEH
  [0x0643, '\u06a9'], // ARABIC LETTER KAF -> ARABIC LETTER KEHEH
]);

function digitValue(codePoint: number): string | undefined {
  // Arabic-Indic digits U+0660..U+0669 and Extended Arabic-Indic (Persian) U+06F0..U+06F9.
  if (codePoint >= 0x0660 && codePoint <= 0x0669) return String(codePoint - 0x0660);
  if (codePoint >= 0x06f0 && codePoint <= 0x06f9) return String(codePoint - 0x06f0);
  return undefined;
}

/**
 * Characters removed outright: tatweel, Arabic harakat and Quranic annotation marks, and
 * invisible formatting and bidi controls. ZWNJ (U+200C) is deliberately absent: it is part of
 * Persian orthography, and the engine's tokenizer already treats it consistently.
 */
const REMOVED_RANGES: readonly (readonly [number, number])[] = [
  [0x00ad, 0x00ad], // SOFT HYPHEN
  [0x0610, 0x061a], // Arabic signs above/below
  [0x061c, 0x061c], // ARABIC LETTER MARK
  [0x0640, 0x0640], // TATWEEL
  [0x064b, 0x065f], // harakat: tanween, fatha, damma, kasra, shadda, sukun, ...
  [0x0670, 0x0670], // SUPERSCRIPT ALEF
  [0x06d6, 0x06dc], // Quranic annotation marks
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x200b, 0x200b], // ZERO WIDTH SPACE
  [0x200d, 0x200f], // ZERO WIDTH JOINER, LRM, RLM
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x2060], // WORD JOINER
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // ZERO WIDTH NO-BREAK SPACE
];

function removed(codePoint: number): boolean {
  return REMOVED_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
}

/** Any run of Unicode whitespace, including no-break and ideographic spaces. */
const WHITESPACE = /\s+/gu;

export function canonicalizeSearchText(text: string): string {
  let result = '';
  for (const character of text.normalize('NFKC')) {
    const codePoint = character.codePointAt(0)!;
    if (removed(codePoint)) continue;
    result += LETTERS.get(codePoint) ?? digitValue(codePoint) ?? character;
  }
  // Normalised again after removal, so a mark that separated two composable characters cannot
  // leave a non-normalised sequence behind and break idempotence.
  return result.normalize('NFKC').replace(WHITESPACE, ' ').trim();
}

/** Number of Unicode code points that are not whitespace. */
export function significantLength(text: string): number {
  let count = 0;
  for (const character of text) {
    if (!/\s/u.test(character)) count += 1;
  }
  return count;
}
