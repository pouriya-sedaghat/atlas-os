import { describe, expect, it } from 'vitest';

import {
  canonicalizeSearchText,
  significantLength,
} from '../../packages/atlas-os/src/internal/search/canonical.js';

/** Builds strings from code points so no invisible character hides in this source file. */
function cp(...codePoints: number[]): string {
  return String.fromCodePoint(...codePoints);
}

const ZWNJ = cp(0x200c);
const PERSIAN_YEH = cp(0x06cc);
const ARABIC_YEH = cp(0x064a);
const ALEF_MAKSURA = cp(0x0649);
const PERSIAN_KAF = cp(0x06a9);
const ARABIC_KAF = cp(0x0643);

describe('search text canonicalisation', () => {
  it.each([
    ['Arabic yeh to Persian yeh', `ول${ARABIC_YEH}عصر`, `ول${PERSIAN_YEH}عصر`],
    ['alef maksura to Persian yeh', `ول${ALEF_MAKSURA}عصر`, `ول${PERSIAN_YEH}عصر`],
    ['Arabic kaf to Persian kaf', `${ARABIC_KAF}رمان`, `${PERSIAN_KAF}رمان`],
    ['Persian digits to ASCII', 'پارک ۱۵ خرداد', 'پارک 15 خرداد'],
    ['Arabic-Indic digits to ASCII', `خیابان آزادی ${cp(0x0661, 0x0662)}`, 'خیابان آزادی 12'],
    ['fatha removed', `ت${cp(0x064e)}هران`, 'تهران'],
    ['kasra and sukun removed', `ت${cp(0x0650)}ه${cp(0x0652)}ران`, 'تهران'],
    ['tatweel removed', `ته${cp(0x0640)}ران`, 'تهران'],
    ['bidi controls removed', `${cp(0x200f)}تهران${cp(0x200e, 0x202b)}`, 'تهران'],
    ['isolates removed', `${cp(0x2067)}تهران${cp(0x2069)}`, 'تهران'],
    ['zero-width space and joiner removed', `ته${cp(0x200b)}ر${cp(0x200d)}ان`, 'تهران'],
    [
      'whitespace collapsed and trimmed',
      `  خیابان${cp(0x00a0)}${cp(0x2003)} آزادی\t`,
      'خیابان آزادی',
    ],
    ['presentation forms folded by NFKC', cp(0xfee9, 0xfeea), cp(0x0647, 0x0647)],
    ['Latin text untouched apart from spacing', '  Azadi   Street ', 'Azadi Street'],
  ])('%s', (_name, input, expected) => {
    expect(canonicalizeSearchText(input)).toBe(expected);
  });

  it('deliberately preserves ZWNJ, which is part of Persian orthography', () => {
    const text = `کتاب${ZWNJ}فروشی`;
    expect(canonicalizeSearchText(text)).toBe(text);
  });

  it('composes a decomposed hamza form rather than stripping its mark', () => {
    // ALEF + HAMZA ABOVE composes to ALEF WITH HAMZA ABOVE under NFKC before marks are removed.
    expect(canonicalizeSearchText(cp(0x0627, 0x0654))).toBe(cp(0x0623));
  });

  it('is idempotent over a broad sample of Arabic-script, Latin and control inputs', () => {
    // A deterministic pseudo-random sample over the ranges canonicalisation touches.
    const ranges = [
      [0x0020, 0x007e],
      [0x00a0, 0x00ff],
      [0x0600, 0x06ff],
      [0x200b, 0x200f],
      [0x202a, 0x202e],
      [0x2066, 0x2069],
      [0xfb50, 0xfdff],
      [0xfe70, 0xfeff],
    ] as const;
    let seed = 0x5eed;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let sample = 0; sample < 2000; sample += 1) {
      let text = '';
      const length = next() % 24;
      for (let index = 0; index < length; index += 1) {
        const [low, high] = ranges[next() % ranges.length]!;
        text += cp(low + (next() % (high - low + 1)));
      }
      const once = canonicalizeSearchText(text);
      expect(canonicalizeSearchText(once), JSON.stringify(text)).toBe(once);
    }
  });

  it('counts significant code points without whitespace', () => {
    expect(significantLength('ته')).toBe(2);
    expect(significantLength(' a  b ')).toBe(2);
    expect(significantLength(cp(0x1f600))).toBe(1);
  });
});
