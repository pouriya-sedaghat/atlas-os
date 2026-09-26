import type {
  Coordinate,
  ReverseGeocodeRequest,
  SearchInvalidReason,
  SearchLanguage,
  SearchParameters,
  SearchRequest,
  SearchRequestField,
} from '../../contracts.js';
import { canonicalizeSearchText, significantLength } from './canonical.js';

/** Public limits of the search contract. Everything outside them is refused before any I/O. */
export const SEARCH_LIMITS = {
  defaultLimit: 5,
  maxLimit: 20,
  maxQueryBytes: 400,
  maxQueryCodePoints: 100,
  minQueryCodePoints: 2,
} as const;

export const DEFAULT_SEARCH_LANGUAGE: SearchLanguage = 'fa';

export type ParsedRequest<T> =
  | { readonly ok: true; readonly request: T }
  | {
      readonly ok: false;
      readonly field: SearchRequestField;
      readonly reason: SearchInvalidReason;
    };

function invalid<T>(field: SearchRequestField, reason: SearchInvalidReason): ParsedRequest<T> {
  return { field, ok: false, reason };
}

/** Whether a string contains a C0 or C1 control character, including DEL. */
export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

/** A plain decimal number: no exponent, no hexadecimal, no surrounding whitespace. */
const DECIMAL = /^-?(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,15})?$/;

function single(
  parameters: SearchParameters,
  allowed: readonly string[],
): ParsedRequest<Readonly<Record<string, string>>> {
  const values: Record<string, string> = {};
  for (const [key, occurrences] of Object.entries(parameters)) {
    if (!allowed.includes(key)) return invalid('parameters', 'unknown');
    if (occurrences.length !== 1) return invalid(key as SearchRequestField, 'duplicated');
    values[key] = occurrences[0]!;
  }
  return { ok: true, request: values };
}

function parseLanguage(value: string | undefined): ParsedRequest<SearchLanguage> {
  if (value === undefined) return { ok: true, request: DEFAULT_SEARCH_LANGUAGE };
  if (value === 'fa' || value === 'en') return { ok: true, request: value };
  return invalid('language', 'unsupported');
}

function parseNumber(field: 'lat' | 'lon', value: string, limit: number): ParsedRequest<number> {
  if (!DECIMAL.test(value)) return invalid(field, 'not_a_number');
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return invalid(field, 'not_a_number');
  if (parsed < -limit || parsed > limit) return invalid(field, 'out_of_range');
  return { ok: true, request: parsed };
}

function parseCoordinate(
  values: Readonly<Record<string, string>>,
  required: boolean,
): ParsedRequest<Coordinate | undefined> {
  const lat = values['lat'];
  const lon = values['lon'];
  if (lat === undefined && lon === undefined) {
    return required ? invalid('lat', 'missing') : { ok: true, request: undefined };
  }
  if (lat === undefined) return invalid('lat', required ? 'missing' : 'incomplete_coordinate');
  if (lon === undefined) return invalid('lon', required ? 'missing' : 'incomplete_coordinate');
  const latitude = parseNumber('lat', lat, 90);
  if (!latitude.ok) return latitude;
  const longitude = parseNumber('lon', lon, 180);
  if (!longitude.ok) return longitude;
  return { ok: true, request: { latitude: latitude.request, longitude: longitude.request } };
}

/**
 * Parses raw forward-search parameters.
 *
 * Unknown and duplicated parameters are refused rather than ignored, so a client can never
 * believe it influenced a search through a parameter that was silently dropped.
 */
export function parseSearchParameters(parameters: SearchParameters): ParsedRequest<SearchRequest> {
  const values = single(parameters, ['q', 'limit', 'language', 'lat', 'lon']);
  if (!values.ok) return values;
  const raw = values.request;

  const q = raw['q'];
  if (q === undefined) return invalid('q', 'missing');
  if (hasControlCharacter(q)) return invalid('q', 'control_character');
  if (Buffer.byteLength(q, 'utf8') > SEARCH_LIMITS.maxQueryBytes) return invalid('q', 'too_long');
  const query = canonicalizeSearchText(q);
  const length = significantLength(query);
  if (length < SEARCH_LIMITS.minQueryCodePoints) return invalid('q', 'too_short');
  if (length > SEARCH_LIMITS.maxQueryCodePoints) return invalid('q', 'too_long');

  let limit: number = SEARCH_LIMITS.defaultLimit;
  const rawLimit = raw['limit'];
  if (rawLimit !== undefined) {
    if (!/^[0-9]{1,3}$/.test(rawLimit)) return invalid('limit', 'not_an_integer');
    limit = Number(rawLimit);
    if (limit < 1 || limit > SEARCH_LIMITS.maxLimit) return invalid('limit', 'out_of_range');
  }

  const language = parseLanguage(raw['language']);
  if (!language.ok) return language;

  const near = parseCoordinate(raw, false);
  if (!near.ok) return near;

  return {
    ok: true,
    request: {
      language: language.request,
      limit,
      query,
      ...(near.request === undefined ? {} : { near: near.request }),
    },
  };
}

/** Parses raw reverse geocoding parameters. Both coordinates are required. */
export function parseReverseParameters(
  parameters: SearchParameters,
): ParsedRequest<ReverseGeocodeRequest> {
  const values = single(parameters, ['lat', 'lon', 'language']);
  if (!values.ok) return values;
  const coordinate = parseCoordinate(values.request, true);
  if (!coordinate.ok) return coordinate;
  const language = parseLanguage(values.request['language']);
  if (!language.ok) return language;
  return { ok: true, request: { coordinate: coordinate.request!, language: language.request } };
}
