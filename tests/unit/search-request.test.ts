import { parseReverseParameters, parseSearchParameters } from '@atlas-os/platform';
import { describe, expect, it } from 'vitest';

function params(values: Record<string, string | string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? value : [value]]),
  );
}

function refused(field: string, reason: string) {
  return { ok: false, outcome: { field, outcome: 'invalid_request', reason } };
}

describe('forward search parameters', () => {
  it('applies defaults and canonicalises the query', () => {
    const parsed = parseSearchParameters(params({ q: `  كرمان ` }));
    expect(parsed).toEqual({
      ok: true,
      request: { language: 'fa', limit: 5, query: 'کرمان' },
    });
  });

  it('accepts a complete request with location bias', () => {
    expect(
      parseSearchParameters(
        params({ language: 'en', lat: '35.7', limit: '20', lon: '51.37', q: 'Azadi' }),
      ),
    ).toEqual({
      ok: true,
      request: {
        language: 'en',
        limit: 20,
        near: { latitude: 35.7, longitude: 51.37 },
        query: 'Azadi',
      },
    });
  });

  it.each([
    ['an unknown parameter', { q: 'Tehran', radius: '5' }, 'parameters', 'unknown'],
    ['an engine parameter', { dedupe: '1', q: 'Tehran' }, 'parameters', 'unknown'],
    ['a duplicated query', { q: ['Tehran', 'Shiraz'] }, 'q', 'duplicated'],
    ['a duplicated limit', { limit: ['1', '2'], q: 'Tehran' }, 'limit', 'duplicated'],
    ['a missing query', { limit: '5' }, 'q', 'missing'],
    ['a one-letter query', { q: 'a' }, 'q', 'too_short'],
    [
      'a query that is only removable marks',
      { q: String.fromCodePoint(0x064e, 0x0640, 0x64e) },
      'q',
      'too_short',
    ],
    ['a query over 100 code points', { q: 'a'.repeat(101) }, 'q', 'too_long'],
    ['a query over 400 bytes', { q: 'ت'.repeat(201) }, 'q', 'too_long'],
    [
      'a control character',
      { q: `Teh${String.fromCodePoint(0x0007)}ran` },
      'q',
      'control_character',
    ],
    [
      'a C1 control character',
      { q: `Teh${String.fromCodePoint(0x0085)}ran` },
      'q',
      'control_character',
    ],
    ['a newline', { q: 'Teh\nran' }, 'q', 'control_character'],
    ['a zero limit', { limit: '0', q: 'Tehran' }, 'limit', 'out_of_range'],
    ['a limit above twenty', { limit: '21', q: 'Tehran' }, 'limit', 'out_of_range'],
    ['a negative limit', { limit: '-1', q: 'Tehran' }, 'limit', 'not_an_integer'],
    ['a fractional limit', { limit: '2.5', q: 'Tehran' }, 'limit', 'not_an_integer'],
    ['an unsupported language', { language: 'de', q: 'Tehran' }, 'language', 'unsupported'],
    ['the private language', { language: 'qaa', q: 'Tehran' }, 'language', 'unsupported'],
    ['latitude without longitude', { lat: '35.7', q: 'Tehran' }, 'lon', 'incomplete_coordinate'],
    ['longitude without latitude', { lon: '51', q: 'Tehran' }, 'lat', 'incomplete_coordinate'],
    ['a latitude out of range', { lat: '91', lon: '51', q: 'Tehran' }, 'lat', 'out_of_range'],
    ['a non-numeric longitude', { lat: '35', lon: 'abc', q: 'Tehran' }, 'lon', 'not_a_number'],
    ['an exponent', { lat: '3.5e1', lon: '51', q: 'Tehran' }, 'lat', 'not_a_number'],
    ['an infinite value', { lat: 'Infinity', lon: '51', q: 'Tehran' }, 'lat', 'not_a_number'],
  ])('refuses %s', (_case, values, field, reason) => {
    expect(parseSearchParameters(params(values))).toEqual(refused(field, reason));
  });

  it('counts the minimum length on significant characters of the canonical query', () => {
    expect(parseSearchParameters(params({ q: 'ته' }))).toMatchObject({ ok: true });
    expect(parseSearchParameters(params({ q: ' ت ' }))).toEqual(refused('q', 'too_short'));
  });
});

describe('reverse geocoding parameters', () => {
  it('requires both coordinates and defaults the language', () => {
    expect(parseReverseParameters(params({ lat: '35.7002', lon: '51.3605' }))).toEqual({
      ok: true,
      request: { coordinate: { latitude: 35.7002, longitude: 51.3605 }, language: 'fa' },
    });
  });

  it.each([
    ['no coordinates', {}, 'lat', 'missing'],
    ['no longitude', { lat: '35' }, 'lon', 'missing'],
    ['a query parameter', { lat: '35', lon: '51', q: 'x' }, 'parameters', 'unknown'],
    ['a radius', { lat: '35', lon: '51', radius: '10' }, 'parameters', 'unknown'],
    ['duplicated latitude', { lat: ['35', '36'], lon: '51' }, 'lat', 'duplicated'],
    ['an out-of-range longitude', { lat: '35', lon: '181' }, 'lon', 'out_of_range'],
  ])('refuses %s', (_case, values, field, reason) => {
    expect(parseReverseParameters(params(values))).toEqual(refused(field, reason));
  });
});
