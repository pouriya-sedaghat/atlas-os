// A stand-in for the search engine's serve command, used by host and guard tests.
//
// It is started by the real engine host exactly as the engine is: as a child process given a data
// directory and a loopback port. It reads its places from a file inside the working copy, answers
// the same status, search and reverse shapes, and writes into its data directory on start as the
// real engine does. A private control route lets a test hold and release answers, or crash the
// process, so interleavings are forced deterministically instead of by timing.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const dataDirectory = argument('-data-dir');
const port = Number(argument('-listen-port'));
const node = join(dataDirectory, 'photon_data', 'node_1');
const data = JSON.parse(await readFile(join(node, 'data', 'fake-engine.json'), 'utf8'));

// The real engine rewrites cluster state in its data directory whenever it starts.
await mkdir(join(node, 'data', 'nodes', '0'), { recursive: true });
await writeFile(join(node, 'data', 'nodes', '0', 'runtime.lock'), String(process.pid));

let held = [];
let holding = false;
let answered = 0;

// The engine prints instants without a zero millisecond part; so does this stand-in.
function engineInstant(value) {
  return new Date(value).toISOString().replace('.000Z', 'Z');
}

function feature(place, language) {
  const properties = {
    osm_type: place.osm_type,
    osm_id: place.osm_id,
    osm_key: place.osm_key,
    osm_value: place.osm_value,
    type: place.type,
    ...(place.names ? { name: place.names[language] ?? place.names.fa } : {}),
    ...(place.housenumber ? { housenumber: place.housenumber } : {}),
    ...(place.extra ? { extra: place.extra } : {}),
    countrycode: 'IR',
  };
  return {
    geometry: { coordinates: place.coordinates, type: 'Point' },
    properties,
    type: 'Feature',
  };
}

function distance(place, lat, lon) {
  const [plon, plat] = place.coordinates;
  return Math.hypot(plon - lon, plat - lat);
}

function canary() {
  return {
    coordinates: [data.canary.longitude, data.canary.latitude],
    extra: { atlas_generation: data.generation },
    names: { en: 'canary', fa: 'canary' },
    osm_id: 0,
    osm_key: 'atlas',
    osm_type: 'X',
    osm_value: 'generation',
    type: 'other',
  };
}

function answer(url) {
  const language = url.searchParams.get('lang') ?? 'fa';
  const limit = Number(url.searchParams.get('limit') ?? '5');
  const all = [...data.places, canary()];
  if (url.pathname === '/api') {
    const query = url.searchParams.get('q') ?? '';
    const matches = all.filter((place) =>
      Object.values(place.names ?? {}).some((name) => name.includes(query) || query.includes(name)),
    );
    return matches.slice(0, limit).map((place) => feature(place, language));
  }
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  return all
    .filter((place) => distance(place, lat, lon) < 0.01)
    .sort((a, b) => distance(a, lat, lon) - distance(b, lat, lon))
    .slice(0, limit)
    .map((place) => feature(place, language));
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://engine.invalid');
  const json = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === '/__control') {
    const action = url.searchParams.get('action');
    if (action === 'hold') holding = true;
    if (action === 'release') {
      holding = false;
      for (const release of held.splice(0)) release();
    }
    if (action === 'exit') {
      // `code` stands in for the runtime's own exit status, such as 3 after heap exhaustion.
      const code = Number(url.searchParams.get('code') ?? '1');
      json(200, { exiting: true });
      setImmediate(() => process.exit(code));
      return;
    }
    if (action === 'kill') {
      // Ended by a signal, as the kernel ends a process that reaches its memory limit.
      json(200, { killed: true });
      setImmediate(() => process.kill(process.pid, 'SIGKILL'));
      return;
    }
    json(200, { answered, held: held.length, holding, pid: process.pid });
    return;
  }
  if (url.pathname === '/status') {
    json(200, { import_date: engineInstant(data.importDate), status: 'Ok', version: 'fake' });
    return;
  }
  if (url.pathname !== '/api' && url.pathname !== '/reverse') {
    json(404, { message: 'not found' });
    return;
  }
  const respond = () => {
    answered += 1;
    json(200, { features: answer(url), type: 'FeatureCollection' });
  };
  // The canary and probe checks the host runs while loading are never held.
  const verifying = url.searchParams.get('limit') === '1' && url.pathname === '/reverse';
  if (holding && !verifying) held.push(respond);
  else respond();
});

setTimeout(() => {
  server.listen(port, '127.0.0.1');
}, data.startupMs ?? 0);

process.on('SIGTERM', () => process.exit(0));
