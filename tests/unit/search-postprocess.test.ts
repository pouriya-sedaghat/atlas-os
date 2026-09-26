import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendCanary,
  postProcessDump,
  serializeDumpRow,
} from '../../packages/atlas-os/src/internal/search/dump/postprocess.js';
import {
  SYNTHETIC_ID_BASE,
  syntheticDump,
  syntheticPlaceId,
  writeSyntheticDump,
} from '../../packages/atlas-os/src/internal/search/dump/synthetic.js';

const BOUNDS = { east: 63.333, north: 39.782, south: 24.397, west: 44.033 } as const;
const IMPORT_DATE = '2026-09-24T12:00:00.123Z';
const MARKER = `sha256:${'ab'.repeat(32)}`;

const ARABIC_KAF = String.fromCodePoint(0x0643);
const ARABIC_YEH = String.fromCodePoint(0x064a);
const PERSIAN_ONE = String.fromCodePoint(0x06f1);
const PERSIAN_TWO = String.fromCodePoint(0x06f2);

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'atlas-os-dump-'));
  directories.push(path);
  return path;
}

async function processText(text: string) {
  const root = await workspace();
  const input = join(root, 'raw.jsonl');
  const output = join(root, 'dump.jsonl');
  await writeFile(input, text, 'utf8');
  const result = await postProcessDump({
    bounds: BOUNDS,
    engineImportDate: IMPORT_DATE,
    input,
    output,
  });
  const lines = (await readFile(output, 'utf8')).split('\n').filter((line) => line.length > 0);
  return { lines, output, result, rows: lines.map((line) => JSON.parse(line) as Row) };
}

interface Row {
  readonly type: string;
  readonly content: unknown;
}

type Document = Record<string, unknown> & {
  readonly name?: Record<string, string>;
  readonly extra?: Record<string, string>;
  readonly address?: Record<string, string | string[]>;
};

function places(rows: readonly Row[]): Document[] {
  return rows.filter((row) => row.type === 'Place').flatMap((row) => row.content as Document[]);
}

const HEADER = serializeDumpRow('NominatimDumpFile', {
  version: '0.1.0',
  generator: 'photon',
  database_version: '1.0.0-4',
  data_timestamp: '2026-09-01T00:00:00.000+00:00',
  features: { sorted_by_country: true, has_addresslines: false },
});

function place(document: Record<string, unknown>): string {
  return serializeDumpRow('Place', [
    {
      place_id: '1',
      object_type: 'N',
      object_id: 1,
      osm_key: 'place',
      osm_value: 'city',
      categories: ['osm.place.city'],
      address_type: 'city',
      importance: 0.5,
      country_code: 'ir',
      centroid: [51.389, 35.6892],
      ...document,
    },
  ]);
}

describe('search dump post-processing', () => {
  it('replaces the header timestamp with the unique import instant and keeps type first', async () => {
    const { lines, result, rows } = await processText(syntheticDump());
    expect(rows[0]).toMatchObject({
      content: { data_timestamp: IMPORT_DATE, version: '0.1.0' },
      type: 'NominatimDumpFile',
    });
    // The engine's streaming reader rejects a row whose first key is not `type`.
    for (const line of lines) expect(line.startsWith('{"type":')).toBe(true);
    expect(result.sourceDataTimestamp).toBe('2026-01-01T00:00:00.000+00:00');
    expect(result.places).toBe(10);
    expect(result.documents).toBe(10);
  });

  it('adds canonical search-only variants while preserving displayed names and originals', async () => {
    const { result, rows } = await processText(syntheticDump());
    const documents = places(rows);

    const library = documents.find((entry) => entry.object_id === SYNTHETIC_ID_BASE + 10)!;
    expect(library.name!['name']).toBe(`${ARABIC_KAF}تابخانه مل${ARABIC_YEH}`);
    expect(library.name!['name:fa']).toBe(`${ARABIC_KAF}تابخانه مل${ARABIC_YEH}`);
    expect(library.name!['name:qaa']).toBe('کتابخانه ملی');

    const house = documents.find((entry) => entry.object_id === SYNTHETIC_ID_BASE + 9)!;
    expect(house['housenumber']).toBe('12');
    expect(house.extra).toEqual({ atlas_housenumber: `${PERSIAN_ONE}${PERSIAN_TWO}` });

    const tehran = documents.find((entry) => entry.object_id === SYNTHETIC_ID_BASE + 1)!;
    expect(tehran.name).toEqual({ name: 'تهران', 'name:en': 'Tehran', 'name:fa': 'تهران' });
    expect(tehran['extra']).toBeUndefined();

    expect(result.variants).toEqual({ addresses: 0, housenumbers: 1, names: 1, postcodes: 0 });
  });

  it('canonicalises postcodes and address parts, including multi-valued context', async () => {
    const text = `${HEADER}${place({
      address: {
        city: `${ARABIC_KAF}رج`,
        'city:en': 'Karaj',
        other: [`${ARABIC_YEH}زد`, 'تهران'],
        street: 'خیابان آزادی',
      },
      housenumber: `${PERSIAN_ONE}${PERSIAN_TWO}`,
      postcode: `${PERSIAN_ONE}${PERSIAN_TWO}345`,
    })}`;
    const { result, rows } = await processText(text);
    const [document] = places(rows);
    expect(document!.address).toEqual({
      city: `${ARABIC_KAF}رج`,
      'city:en': 'Karaj',
      'city:qaa': 'کرج',
      other: [`${ARABIC_YEH}زد`, 'تهران'],
      'other:qaa': ['یزد'],
      street: 'خیابان آزادی',
    });
    expect(document!['postcode']).toBe('12345');
    expect(document!.extra).toEqual({
      atlas_housenumber: `${PERSIAN_ONE}${PERSIAN_TWO}`,
      atlas_postcode: `${PERSIAN_ONE}${PERSIAN_TWO}345`,
    });
    expect(result.variants).toEqual({ addresses: 2, housenumbers: 1, names: 0, postcodes: 1 });
  });

  it('accepts the leading whitespace the real export writes before each row', async () => {
    const text = `${HEADER} ${place({ name: { name: 'تهران' } })}`;
    const { result } = await processText(text);
    expect(result.places).toBe(1);
  });

  it('is deterministic for the same input and import instant', async () => {
    const first = await processText(syntheticDump());
    const second = await processText(syntheticDump());
    expect(second.result.sha256).toBe(first.result.sha256);
    expect(await readFile(second.output)).toEqual(await readFile(first.output));
    const bytes = await readFile(first.output);
    expect(first.result.bytes).toBe(bytes.length);
    expect(first.result.sha256).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  });

  it('proposes deterministic probe candidates from places inside the bounds only', async () => {
    const { result } = await processText(syntheticDump());
    const search = result.candidates.filter((candidate) => candidate.type === 'search');
    const reverse = result.candidates.filter((candidate) => candidate.type === 'reverse');
    expect(search[0]).toMatchObject({
      expectId: syntheticPlaceId(1),
      language: 'fa',
      query: 'تهران',
    });
    expect(search.some((candidate) => candidate.language === 'en')).toBe(true);
    expect(reverse).toEqual([
      expect.objectContaining({
        coordinate: { latitude: 35.7002, longitude: 51.3605 },
        expectId: syntheticPlaceId(9),
      }),
    ]);
    // Only the best candidates are kept, so the lowest-ranked named place is not among them.
    expect(search.filter((candidate) => candidate.language === 'fa')).toHaveLength(8);
    expect(search.some((candidate) => candidate.expectId === syntheticPlaceId(10))).toBe(false);

    // Queries are proposed in canonical form, never with Arabic letter variants.
    const library = await processText(
      `${HEADER}${place({ name: { name: `${ARABIC_KAF}تابخانه مل${ARABIC_YEH}`, 'name:en': 'Library' } })}`,
    );
    expect(
      library.result.candidates.map((candidate) => candidate.type === 'search' && candidate.query),
    ).toEqual(['کتابخانه ملی', 'Library']);

    const outside = await processText(
      `${HEADER}${place({ centroid: [10, 10], name: { name: 'تهران' } })}`,
    );
    expect(outside.result.candidates).toEqual([]);
  });

  it('appends a canary that the dump checksum excludes', async () => {
    const { output, result } = await processText(syntheticDump());
    const size = await appendCanary(output, {
      coordinate: { latitude: -89.5, longitude: -179.5 },
      marker: MARKER,
    });
    const text = await readFile(output, 'utf8');
    expect(size).toBe(Buffer.byteLength(text, 'utf8'));
    const lines = text.split('\n').filter((line) => line.length > 0);
    const canary = JSON.parse(lines.at(-1)!) as Row;
    expect(lines.at(-1)!.startsWith('{"type":"Place"')).toBe(true);
    expect(canary.content).toEqual([
      expect.objectContaining({
        centroid: [-179.5, -89.5],
        extra: { atlas_generation: MARKER },
        object_id: 0,
        object_type: 'X',
      }),
    ]);
    const withoutCanary = `${lines.slice(0, -1).join('\n')}\n`;
    expect(result.sha256).toBe(
      `sha256:${createHash('sha256').update(withoutCanary, 'utf8').digest('hex')}`,
    );
  });

  it('refuses to overwrite an existing output', async () => {
    const root = await workspace();
    const input = join(root, 'raw.jsonl');
    await writeSyntheticDump(input);
    await writeFile(join(root, 'dump.jsonl'), 'existing');
    await expect(
      postProcessDump({
        bounds: BOUNDS,
        engineImportDate: IMPORT_DATE,
        input,
        output: join(root, 'dump.jsonl'),
      }),
    ).rejects.toThrow();
    await expect(writeSyntheticDump(input)).rejects.toThrow();
  });

  const rejected: readonly (readonly [string, string])[] = [
    ['an empty export', ''],
    ['a first row that is not the header', place({})],
    [
      'address lines it has not been proven against',
      serializeDumpRow('NominatimDumpFile', {
        version: '0.1.0',
        features: { sorted_by_country: true, has_addresslines: true },
      }),
    ],
    [
      'an unsupported header version',
      serializeDumpRow('NominatimDumpFile', {
        version: '0.2.0',
        features: { sorted_by_country: true, has_addresslines: false },
      }),
    ],
    ['a line that is not JSON', `${HEADER}{not json\n`],
    ['an unknown document type', `${HEADER}${serializeDumpRow('Unknown', [])}`],
    ['an unknown place field', `${HEADER}${place({ surprise: true })}`],
    ['a place object instead of an array', `${HEADER}${serializeDumpRow('Place', {})}`],
    ['the reserved canary identity', `${HEADER}${place({ object_id: 0, object_type: 'X' })}`],
    ['a centroid outside the globe', `${HEADER}${place({ centroid: [181, 0] })}`],
  ];

  it.each(rejected)('rejects %s', async (_label, text) => {
    await expect(processText(text)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
