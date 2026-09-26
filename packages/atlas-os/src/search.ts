import type {
  PlaceQueryOutcome,
  ReverseGeocodeRequest,
  SearchParameters,
  SearchRequest,
} from './contracts.js';
import type { ParsedRequest } from './internal/search/request.js';
import {
  DEFAULT_SEARCH_LANGUAGE,
  SEARCH_LIMITS,
  parseReverseParameters as parseReverse,
  parseSearchParameters as parseSearch,
} from './internal/search/request.js';

export { DEFAULT_SEARCH_LANGUAGE, SEARCH_LIMITS };

/** A parsed request, or the `invalid_request` outcome that explains why it was refused. */
export type SearchParse<T> =
  | { readonly ok: true; readonly request: T }
  | {
      readonly ok: false;
      readonly outcome: Extract<PlaceQueryOutcome, { outcome: 'invalid_request' }>;
    };

function toParse<T>(parsed: ParsedRequest<T>): SearchParse<T> {
  if (parsed.ok) return parsed;
  return {
    ok: false,
    outcome: { field: parsed.field, outcome: 'invalid_request', reason: parsed.reason },
  };
}

/**
 * Validates raw forward-search parameters: unknown and duplicated names are refused, the query is
 * canonicalised and bounded, and every number is range-checked before any engine is contacted.
 */
export function parseSearchParameters(parameters: SearchParameters): SearchParse<SearchRequest> {
  return toParse(parseSearch(parameters));
}

/** Validates raw reverse geocoding parameters. */
export function parseReverseParameters(
  parameters: SearchParameters,
): SearchParse<ReverseGeocodeRequest> {
  return toParse(parseReverse(parameters));
}
