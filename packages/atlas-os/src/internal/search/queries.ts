import type { GeographicBounds, PlaceResult, SearchLanguage } from '../../contracts.js';
import type { SearchProbe } from '../../snapshot.js';
import { deduplicatePlaces } from './dedupe.js';
import type { EngineCollection } from './mapping.js';
import { mapEngineCollection } from './mapping.js';
import { SEARCH_LIMITS } from './request.js';

/**
 * How a public query becomes a private host query, and how a host answer becomes results.
 *
 * Shared by the API's search service and by the engine host's load verification, so a probe is
 * asked exactly the way a person's query would be, and judged by exactly the same mapping.
 */

export interface SearchPlanInput {
  readonly query: string;
  readonly language: SearchLanguage;
  readonly limit: number;
  readonly near?: { readonly latitude: number; readonly longitude: number } | undefined;
}

export function searchHostParameters(
  input: SearchPlanInput,
  bounds: GeographicBounds,
): Record<string, string> {
  const parameters: Record<string, string> = {
    bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    lang: input.language,
    // Over-fetch so filtering and de-duplication still leave `limit` results where they exist.
    limit: String(Math.min(SEARCH_LIMITS.maxLimit, Math.max(input.limit * 2, input.limit + 5))),
    q: input.query,
  };
  if (input.near !== undefined) {
    parameters['lat'] = String(input.near.latitude);
    parameters['lon'] = String(input.near.longitude);
  }
  return parameters;
}

/** Reverse lookups over-fetch slightly so the canary or a non-object never displaces a result. */
export const REVERSE_HOST_LIMIT = 3;

export function reverseHostParameters(
  coordinate: { readonly latitude: number; readonly longitude: number },
  language: SearchLanguage,
): Record<string, string> {
  return {
    lang: language,
    lat: String(coordinate.latitude),
    limit: String(REVERSE_HOST_LIMIT),
    lon: String(coordinate.longitude),
  };
}

export function withinBounds(
  bounds: GeographicBounds,
  coordinate: { readonly latitude: number; readonly longitude: number },
): boolean {
  return (
    coordinate.longitude >= bounds.west &&
    coordinate.longitude <= bounds.east &&
    coordinate.latitude >= bounds.south &&
    coordinate.latitude <= bounds.north
  );
}

/** Maps, de-duplicates and trims an engine answer into public results. */
export function placeResults(
  collection: EngineCollection,
  bounds: GeographicBounds,
  limit: number,
): PlaceResult[] {
  return deduplicatePlaces(mapEngineCollection(collection, { bounds })).slice(0, limit);
}

/** The route and host parameters a probe is asked with. */
export function probeRequest(
  probe: SearchProbe,
  bounds: GeographicBounds,
): {
  readonly route: 'search' | 'reverse';
  readonly parameters: Record<string, string>;
  readonly limit: number;
} {
  if (probe.type === 'search') {
    const limit = SEARCH_LIMITS.defaultLimit;
    return {
      limit,
      parameters: searchHostParameters(
        { language: probe.language, limit, query: probe.query },
        bounds,
      ),
      route: 'search',
    };
  }
  return {
    limit: 1,
    parameters: reverseHostParameters(probe.coordinate, probe.language),
    route: 'reverse',
  };
}

/**
 * Whether an answer satisfies a probe: a search probe's place is among the results a person
 * would see, and a reverse probe's place is the one result a person would see.
 */
export function probeSatisfied(
  probe: SearchProbe,
  collection: EngineCollection,
  bounds: GeographicBounds,
): boolean {
  const { limit } = probeRequest(probe, bounds);
  const results = placeResults(collection, bounds, limit);
  return probe.type === 'search'
    ? results.some((result) => result.id === probe.expectId)
    : results[0]?.id === probe.expectId;
}
