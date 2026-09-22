import { readFileSync } from 'node:fs';

import { parseSnapshotManifest, PlatformError } from '@atlas-os/platform';
import { describe, expect, it } from 'vitest';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/snapshots/${name}`, import.meta.url), 'utf8'),
  );
}

describe('snapshot manifest validation', () => {
  it('accepts the M0 fixture manifest', () => {
    expect(parseSnapshotManifest(fixture('valid.json'))).toMatchObject({
      region: 'iran',
      schemaVersion: 1,
      snapshotId: 'm0-fixture',
    });
  });

  it('rejects invalid timestamps, IDs, schemas, and checksums', () => {
    expect(() => parseSnapshotManifest(fixture('invalid.json'))).toThrow(PlatformError);
  });
});
