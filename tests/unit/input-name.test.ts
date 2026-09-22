import { describe, expect, it } from 'vitest';

import { defaultInputName } from '../../apps/cli/src/input-name.js';

/**
 * The absolute path of an operator-supplied input is needed to read it during provisioning, but
 * it must never be recorded as provenance: a manifest travels with the snapshot and must not
 * disclose the build host's filesystem layout. These cases run identically on any host.
 */
describe('default input provenance name', () => {
  it.each([
    ['/srv/sources/iran.osm.pbf', 'iran.osm.pbf'],
    ['/srv/sources/natural_earth_vector.sqlite.zip', 'natural_earth_vector.sqlite.zip'],
    ['./relative/water-polygons-split-3857.zip', 'water-polygons-split-3857.zip'],
    ['iran.osm.pbf', 'iran.osm.pbf'],
    ['/iran.osm.pbf', 'iran.osm.pbf'],
  ])('reduces the POSIX path %s to its file name', (path, expected) => {
    expect(defaultInputName(path)).toBe(expected);
  });

  it.each([
    ['C:\\datasets\\iran.osm.pbf', 'iran.osm.pbf'],
    [
      'C:\\Users\\Operator\\Documents\\natural_earth_vector.sqlite.zip',
      'natural_earth_vector.sqlite.zip',
    ],
    ['D:\\water-polygons-split-3857.zip', 'water-polygons-split-3857.zip'],
    ['\\\\fileserver\\share\\iran.osm.pbf', 'iran.osm.pbf'],
    ['..\\sources\\iran.osm.pbf', 'iran.osm.pbf'],
  ])('reduces the Windows path %s to its file name', (path, expected) => {
    expect(defaultInputName(path)).toBe(expected);
  });

  it('never returns anything containing a separator or a drive designator', () => {
    for (const path of [
      '/srv/sources/iran.osm.pbf',
      'C:\\datasets\\iran.osm.pbf',
      '\\\\server\\share\\file.zip',
      'C:/mixed\\separators/file.zip',
    ]) {
      const name = defaultInputName(path);
      expect(name, `derived from ${path}`).not.toMatch(/[/\\]/);
      expect(name, `derived from ${path}`).not.toMatch(/^[a-zA-Z]:/);
    }
  });

  it('handles mixed separators, as a Windows path passed through a POSIX shell may have', () => {
    expect(defaultInputName('C:/datasets\\iran.osm.pbf')).toBe('iran.osm.pbf');
    expect(defaultInputName('C:\\datasets/iran.osm.pbf')).toBe('iran.osm.pbf');
  });

  it('ignores trailing separators', () => {
    expect(defaultInputName('/srv/sources/')).toBe('sources');
    expect(defaultInputName('C:\\datasets\\')).toBe('datasets');
  });

  it('yields nothing meaningful for a bare root or drive', () => {
    expect(defaultInputName('/')).toBe('');
    expect(defaultInputName('C:')).toBe('');
    expect(defaultInputName('C:\\')).toBe('');
  });
});
