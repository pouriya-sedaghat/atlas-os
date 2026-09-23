import { describe, expect, it } from 'vitest';

import {
  contentRange,
  parseRangeHeader,
  unsatisfiedContentRange,
} from '../../packages/atlas-os/src/internal/http/range.js';

const SIZE = 1_000;

describe('byte range parsing', () => {
  it('returns the whole representation when no range is requested', () => {
    expect(parseRangeHeader(undefined, SIZE)).toEqual({ kind: 'ignored' });
  });

  it.each([
    ['bytes=0-499', 0, 499],
    ['bytes=500-999', 500, 999],
    ['bytes=500-', 500, 999],
    ['bytes=-100', 900, 999],
    ['bytes=0-', 0, 999],
    ['  bytes=10-20  ', 10, 20],
  ])('parses %s', (header, start, end) => {
    expect(parseRangeHeader(header, SIZE)).toEqual({ end, kind: 'satisfiable', start });
  });

  it('clamps an end beyond the resource to the final byte', () => {
    expect(parseRangeHeader('bytes=990-5000', SIZE)).toEqual({
      end: 999,
      kind: 'satisfiable',
      start: 990,
    });
  });

  it('clamps a suffix longer than the resource to the whole resource', () => {
    expect(parseRangeHeader('bytes=-5000', SIZE)).toEqual({
      end: 999,
      kind: 'satisfiable',
      start: 0,
    });
  });

  it.each([['bytes=1000-1001'], ['bytes=1500-'], ['bytes=-0'], ['bytes=300-200']])(
    'rejects unsatisfiable range %s',
    (header) => {
      expect(parseRangeHeader(header, SIZE)).toEqual({ kind: 'unsatisfiable' });
    },
  );

  it.each([['items=0-10'], ['bytes=abc-def'], ['bytes='], ['bytes=0-10, 20-30'], ['garbage']])(
    'ignores an unusable range header %s',
    (header) => {
      // RFC 9110 requires an unsatisfiable range to be refused but a malformed or unsupported one
      // to be ignored, answering with the whole representation.
      expect(parseRangeHeader(header, SIZE)).toEqual({ kind: 'ignored' });
    },
  );

  it('cannot satisfy any range against an empty resource', () => {
    expect(parseRangeHeader('bytes=0-10', 0)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=-10', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  it('formats content range headers', () => {
    expect(contentRange(0, 126, 21_531)).toBe('bytes 0-126/21531');
    expect(unsatisfiedContentRange(21_531)).toBe('bytes */21531');
  });
});
