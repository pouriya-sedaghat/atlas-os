import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, open, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';

import { z } from 'zod';

import { PlatformError } from '../../../errors.js';
import type { GeographicBounds } from '../../../contracts.js';
import { canonicalizeSearchText, significantLength } from '../canonical.js';
import {
  CANARY_OBJECT_ID,
  CANARY_OBJECT_TYPE,
  GENERATION_KEY,
  ORIGINAL_HOUSENUMBER_KEY,
  ORIGINAL_POSTCODE_KEY,
  placeId,
} from '../mapping.js';

/**
 * The dump schema the pinned engine's database export actually writes, as observed from the real
 * pipeline: a `NominatimDumpFile` header, `CountryInfo` documents, and `Place` documents whose
 * content is always an array of fully addressed places (`has_addresslines` is false).
 *
 * Validated strictly. A field or document type this pipeline has not been proven against fails
 * the preparation rather than being passed through or silently dropped.
 */
const namesSchema = z.record(z.string().max(256), z.string().max(4096));
const addressSchema = z.record(
  z.string().max(256),
  z.union([z.string().max(4096), z.array(z.string().max(4096)).max(256)]),
);

const headerSchema = z
  .object({
    content: z
      .object({
        data_timestamp: z.string().max(64).nullable().optional(),
        database_version: z.string().max(64).optional(),
        features: z
          .object({
            has_addresslines: z.literal(false),
            sorted_by_country: z.boolean(),
          })
          .strict(),
        generator: z.string().max(64).optional(),
        version: z.literal('0.1.0'),
      })
      .strict(),
    type: z.literal('NominatimDumpFile'),
  })
  .strict();

const countryInfoSchema = z
  .object({
    content: z
      .array(
        z
          .object({
            country_code: z.string().min(2).max(3),
            name: namesSchema,
          })
          .strict(),
      )
      .max(512),
    type: z.literal('CountryInfo'),
  })
  .strict();

const placeDocumentSchema = z
  .object({
    address: addressSchema.optional(),
    address_type: z.string().max(32).optional(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    categories: z.array(z.string().max(256)).max(256).optional(),
    centroid: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    country_code: z.string().max(3).optional(),
    extra: z.record(z.string().max(256), z.unknown()).optional(),
    geometry: z.record(z.string(), z.unknown()).optional(),
    housenumber: z.string().max(256).optional(),
    importance: z.number().optional(),
    name: namesSchema.optional(),
    object_id: z.number().int().optional(),
    object_type: z.string().max(8).optional(),
    osm_key: z.string().max(256).optional(),
    osm_value: z.string().max(256).optional(),
    place_id: z.union([z.string().max(64), z.number().int()]).optional(),
    postcode: z.string().max(256).optional(),
  })
  .strict();

const placeSchema = z
  .object({
    content: z.array(placeDocumentSchema).max(10_000),
    type: z.literal('Place'),
  })
  .strict();

type PlaceDocument = z.infer<typeof placeDocumentSchema>;

/** The private search-only language that carries canonical variants. Never requested publicly. */
export const VARIANT_LANGUAGE = 'qaa';

export interface VariantCounts {
  names: number;
  addresses: number;
  housenumbers: number;
  postcodes: number;
}

/** A place the sealed database should find again, proposed while the dump streams past. */
export type ProbeCandidate =
  | {
      readonly type: 'search';
      readonly expectId: string;
      readonly language: 'fa' | 'en';
      readonly query: string;
      readonly importance: number;
    }
  | {
      readonly type: 'reverse';
      readonly expectId: string;
      readonly language: 'fa' | 'en';
      readonly coordinate: { readonly latitude: number; readonly longitude: number };
      readonly importance: number;
    };

/** How many candidates of each kind are kept; the best are asked of the engine after import. */
export const PROBE_CANDIDATE_LIMIT = 8;

function rankCandidates(left: ProbeCandidate, right: ProbeCandidate): number {
  if (left.importance !== right.importance) return right.importance - left.importance;
  return left.expectId < right.expectId ? -1 : left.expectId > right.expectId ? 1 : 0;
}

/** Keeps the best `PROBE_CANDIDATE_LIMIT` candidates without holding the whole dump. */
class CandidatePool {
  readonly #entries: ProbeCandidate[] = [];

  offer(candidate: ProbeCandidate): void {
    const worst = this.#entries[PROBE_CANDIDATE_LIMIT - 1];
    if (worst !== undefined && rankCandidates(candidate, worst) >= 0) return;
    this.#entries.push(candidate);
    this.#entries.sort(rankCandidates);
    if (this.#entries.length > PROBE_CANDIDATE_LIMIT) this.#entries.length = PROBE_CANDIDATE_LIMIT;
  }

  get entries(): readonly ProbeCandidate[] {
    return [...this.#entries];
  }
}

function inside(bounds: GeographicBounds, longitude: number, latitude: number): boolean {
  return (
    longitude >= bounds.west &&
    longitude <= bounds.east &&
    latitude >= bounds.south &&
    latitude <= bounds.north
  );
}

function proposeCandidates(
  document: PlaceDocument,
  bounds: GeographicBounds,
  pools: {
    readonly fa: CandidatePool;
    readonly en: CandidatePool;
    readonly reverse: CandidatePool;
  },
): void {
  const id = placeId(document.object_type, document.object_id);
  const [longitude, latitude] = document.centroid;
  if (id === undefined || !inside(bounds, longitude, latitude)) return;
  const importance = document.importance ?? 0;
  const names = document.name ?? {};
  for (const [language, pool, keys] of [
    ['fa', pools.fa, ['name:fa', 'name']],
    ['en', pools.en, ['name:en']],
  ] as const) {
    const source = keys.map((key) => names[key]).find((value) => value !== undefined);
    if (source === undefined) continue;
    const query = canonicalizeSearchText(source);
    if (significantLength(query) < 2 || [...query].length > 100) continue;
    pool.offer({ expectId: id, importance, language, query, type: 'search' });
  }
  // Point addresses make exact reverse probes: nothing else can be nearer than distance zero.
  if (document.object_type === 'N' && document.housenumber !== undefined) {
    pools.reverse.offer({
      coordinate: { latitude, longitude },
      expectId: id,
      importance,
      language: 'fa',
      type: 'reverse',
    });
  }
}

export interface PostProcessResult {
  /** `sha256:<hex>` of the post-processed dump before the canary line is appended. */
  readonly sha256: string;
  readonly bytes: number;
  readonly places: number;
  readonly documents: number;
  readonly variants: Readonly<VariantCounts>;
  /** The header timestamp the source database reported, kept for provenance. */
  readonly sourceDataTimestamp: string | null;
  /** Deterministic probe candidates, best first: Persian search, English search, reverse. */
  readonly candidates: readonly ProbeCandidate[];
}

/**
 * One dump row. The engine's streaming reader requires `type` to be the first key of every row,
 * so rows are always serialised in that order rather than in whatever order an object holds.
 */
export function serializeDumpRow(type: string, content: unknown): string {
  return `{"type":${JSON.stringify(type)},"content":${JSON.stringify(content)}}\n`;
}

function refuse(message: string, line: number): never {
  throw new PlatformError('VALIDATION_FAILED', message, { details: { line } });
}

/**
 * Adds a canonical search-only name variant when the displayed name differs from its canonical
 * form. The displayed names themselves are never changed.
 */
function addNameVariant(names: Record<string, string>): boolean {
  const existing = new Set(Object.values(names));
  for (const key of ['name:fa', 'name']) {
    const source = names[key];
    if (source === undefined) continue;
    const canonical = canonicalizeSearchText(source);
    if (canonical.length > 0 && !existing.has(canonical)) {
      names[`name:${VARIANT_LANGUAGE}`] = canonical;
      return true;
    }
  }
  return false;
}

function canonicalValues(value: string | readonly string[]): string | string[] | undefined {
  if (typeof value === 'string') {
    const canonical = canonicalizeSearchText(value);
    return canonical.length > 0 && canonical !== value ? canonical : undefined;
  }
  const changed = value
    .map((entry) => ({ canonical: canonicalizeSearchText(entry), entry }))
    .filter(({ canonical, entry }) => canonical.length > 0 && canonical !== entry)
    .map(({ canonical }) => canonical);
  return changed.length === 0 ? undefined : changed;
}

function addAddressVariants(address: Record<string, string | string[]>): number {
  let added = 0;
  const bases = Object.keys(address).filter((key) => !key.includes(':') && key !== 'postcode');
  for (const base of bases) {
    const source = address[`${base}:fa`] ?? address[base]!;
    const canonical = canonicalValues(source);
    if (canonical !== undefined) {
      address[`${base}:${VARIANT_LANGUAGE}`] = canonical;
      added += 1;
    }
  }
  return added;
}

function processDocument(document: PlaceDocument, counts: VariantCounts): PlaceDocument {
  const result: PlaceDocument = { ...document };
  if (result.name !== undefined) {
    const names = { ...result.name };
    if (addNameVariant(names)) counts.names += 1;
    result.name = names;
  }
  if (result.address !== undefined) {
    const address = { ...result.address };
    counts.addresses += addAddressVariants(address);
    result.address = address;
  }
  const extra: Record<string, unknown> = { ...(result.extra ?? {}) };
  // Canonical house numbers and postcodes are searchable; the originals travel in private extra
  // fields so a person always sees the value as it was mapped.
  if (result.housenumber !== undefined) {
    const canonical = canonicalizeSearchText(result.housenumber);
    if (canonical.length > 0 && canonical !== result.housenumber) {
      extra[ORIGINAL_HOUSENUMBER_KEY] = result.housenumber;
      result.housenumber = canonical;
      counts.housenumbers += 1;
    }
  }
  if (result.postcode !== undefined) {
    const canonical = canonicalizeSearchText(result.postcode);
    if (canonical.length > 0 && canonical !== result.postcode) {
      extra[ORIGINAL_POSTCODE_KEY] = result.postcode;
      result.postcode = canonical;
      counts.postcodes += 1;
    }
  }
  if (Object.keys(extra).length > 0) result.extra = extra;
  return result;
}

/**
 * Streams a database export into the dump the search engine imports.
 *
 * Deterministic for a given input and import instant: the header timestamp becomes the unique
 * engine import instant, canonical search-only variants are added under the private language,
 * and nothing else changes. Stable identifiers, displayed names, original house numbers and
 * postcodes are all preserved.
 */
export async function postProcessDump(options: {
  readonly input: string;
  readonly output: string;
  readonly engineImportDate: string;
  /** Only places inside these bounds are proposed as probes. */
  readonly bounds: GeographicBounds;
}): Promise<PostProcessResult> {
  const hash = createHash('sha256');
  // Opened exclusively up front, so an existing output fails fast instead of being appended to.
  const writer = (await open(options.output, 'wx')).createWriteStream();
  let failure: unknown;
  writer.on('error', (error) => {
    failure ??= error;
  });
  const counts: VariantCounts = { addresses: 0, housenumbers: 0, names: 0, postcodes: 0 };
  let bytes = 0;
  let places = 0;
  let documents = 0;
  let line = 0;
  let sawHeader = false;
  let sourceDataTimestamp: string | null = null;
  const pools = { en: new CandidatePool(), fa: new CandidatePool(), reverse: new CandidatePool() };

  const write = async (type: string, content: unknown) => {
    const text = serializeDumpRow(type, content);
    hash.update(text, 'utf8');
    bytes += Buffer.byteLength(text, 'utf8');
    if (!writer.write(text)) await once(writer, 'drain');
  };

  const reader = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(options.input, { encoding: 'utf8' }),
  });
  try {
    for await (const text of reader) {
      line += 1;
      if (text.trim().length === 0) continue;
      let row: unknown;
      try {
        row = JSON.parse(text);
      } catch {
        refuse('The search dump contains a line that is not a JSON document.', line);
      }
      const type = (row as { type?: unknown } | null)?.type;
      if (!sawHeader) {
        const header = headerSchema.safeParse(row);
        if (!header.success)
          refuse('The search dump does not start with a supported header.', line);
        sawHeader = true;
        sourceDataTimestamp = header.data.content.data_timestamp ?? null;
        await write('NominatimDumpFile', {
          ...header.data.content,
          data_timestamp: options.engineImportDate,
        });
        continue;
      }
      if (type === 'CountryInfo') {
        const info = countryInfoSchema.safeParse(row);
        if (!info.success)
          refuse('The search dump contains an unsupported country document.', line);
        await write(
          'CountryInfo',
          info.data.content.map((entry) => {
            const names = { ...entry.name };
            addNameVariant(names);
            return { ...entry, name: names };
          }),
        );
        continue;
      }
      if (type === 'Place') {
        const place = placeSchema.safeParse(row);
        if (!place.success) refuse('The search dump contains an unsupported place document.', line);
        places += 1;
        documents += place.data.content.length;
        for (const document of place.data.content) {
          if (document.object_type === CANARY_OBJECT_TYPE) {
            refuse('The search dump already contains a reserved object type.', line);
          }
          proposeCandidates(document, options.bounds, pools);
        }
        await write(
          'Place',
          place.data.content.map((document) => processDocument(document, counts)),
        );
        continue;
      }
      refuse('The search dump contains an unsupported document type.', line);
    }
    if (!sawHeader) refuse('The search dump is empty.', line);
  } finally {
    reader.close();
    writer.end();
    await finished(writer).catch((error: unknown) => {
      failure ??= error;
    });
  }
  if (failure !== undefined) throw failure;

  return {
    bytes,
    candidates: [...pools.fa.entries, ...pools.en.entries, ...pools.reverse.entries],
    documents,
    places,
    sha256: `sha256:${hash.digest('hex')}`,
    sourceDataTimestamp,
    variants: counts,
  };
}

/**
 * Appends the generation canary: one place outside every public region, at a reserved identity no
 * OpenStreetMap object can have, carrying the full generation marker in a private extra field.
 */
export async function appendCanary(
  output: string,
  canary: {
    readonly marker: string;
    readonly coordinate: { readonly latitude: number; readonly longitude: number };
  },
): Promise<number> {
  const content = [
    {
      address_type: 'other',
      categories: [],
      centroid: [canary.coordinate.longitude, canary.coordinate.latitude],
      extra: { [GENERATION_KEY]: canary.marker },
      importance: 0,
      name: {
        name: `atlas-generation-${canary.marker.slice('sha256:'.length, 'sha256:'.length + 16)}`,
      },
      object_id: CANARY_OBJECT_ID,
      object_type: CANARY_OBJECT_TYPE,
      osm_key: 'atlas',
      osm_value: 'generation',
      place_id: 'atlas-generation',
    },
  ];
  await appendFile(output, serializeDumpRow('Place', content), 'utf8');
  return (await stat(output)).size;
}
