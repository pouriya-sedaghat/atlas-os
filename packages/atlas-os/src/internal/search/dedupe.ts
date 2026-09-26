import type { PlaceResult } from '../../contracts.js';
import { canonicalizeSearchText } from './canonical.js';

function part(value: string | undefined): string {
  return value === undefined ? '' : canonicalizeSearchText(value).toLowerCase();
}

/**
 * The identity two results must share to be the same place for a person reading the list.
 *
 * The engine's own de-duplication keys streets by name, postcode and country only, which hides a
 * same-named street in another city (measured). This key adds the administrative context, so
 * separate streets stay separate while split segments of one street in one district collapse.
 * House results are keyed by their full address instead of a name they usually lack.
 */
export function deduplicationKey(result: PlaceResult): string {
  const address = result.address;
  if (result.kind === 'house') {
    return [
      'house',
      part(address['housenumber']),
      part(address['street']),
      part(address['district']),
      part(address['city']),
      part(address['postcode']),
    ].join('\u0000');
  }
  return [
    result.category,
    part(result.name),
    part(address['locality']),
    part(address['district']),
    part(address['city']),
    part(address['county']),
    part(address['state']),
  ].join('\u0000');
}

/** Keeps the first (highest-ranked) result for every identity, preserving order. */
export function deduplicatePlaces(results: readonly PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const kept: PlaceResult[] = [];
  for (const result of results) {
    const key = deduplicationKey(result);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(result);
  }
  return kept;
}
