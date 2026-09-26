import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function repositoryFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('supply-chain pinning', () => {
  it('pins every GitHub Action to a full commit SHA', () => {
    const workflow = repositoryFile('.github/workflows/ci.yml');
    const actionReferences = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
    expect(actionReferences.length).toBeGreaterThan(0);
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^[^@]+@[a-f0-9]{40}$/);
    }
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d+/);
  });

  it('pins every external base image to an immutable sha256 digest', () => {
    const files = [
      repositoryFile('infra/images/server.Dockerfile'),
      repositoryFile('infra/images/web.Dockerfile'),
      repositoryFile('infra/compose/compose.yaml'),
    ].join('\n');
    for (const image of ['node:22.14.0-alpine3.21', 'nginxinc/nginx-unprivileged:1.27.5-alpine']) {
      const escaped = image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(files).toMatch(new RegExp(`${escaped}@sha256:[a-f0-9]{64}`));
    }
    expect(files).not.toMatch(
      /(?:FROM|image:)\s+(?:node|nginxinc\/nginx-unprivileged):[^\s@]+(?:\s|$)/,
    );
  });

  it('pins the external tile tool image by immutable digest', () => {
    const tool = repositoryFile('packages/atlas-os/src/internal/tools/planetiler.ts');
    expect(tool).toMatch(/ghcr\.io\/[^'\s]+@sha256:[a-f0-9]{64}/);
    expect(tool).not.toMatch(/:latest/);
  });

  it('pins the search images, their system packages and the engine archive', () => {
    const serving = repositoryFile('infra/images/search.Dockerfile');
    const provisioning = repositoryFile('infra/images/search-build.Dockerfile');
    for (const dockerfile of [serving, provisioning]) {
      // Base images by digest, and only by digest.
      for (const match of dockerfile.matchAll(/^ARG (?:NODE|JRE|BASE)_IMAGE=(\S+)$/gm)) {
        expect(match[1]).toMatch(/^[a-z0-9./-]+:[\w.-]+@sha256:[a-f0-9]{64}$/);
      }
      // Every stage starts from a pinned argument image or from an earlier stage of this file.
      const stages = new Set<string>();
      for (const [, from, name] of dockerfile.matchAll(/^FROM (\S+)(?: AS (\S+))?$/gm)) {
        expect(/^\$\{(?:NODE|JRE|BASE)_IMAGE\}$/.test(from!) || stages.has(from!), from).toBe(true);
        if (name !== undefined) stages.add(name);
      }
      expect(stages.size).toBeGreaterThan(1);
      // The engine archive: one release URL, verified by digest and size.
      expect(dockerfile).toContain(
        'https://github.com/komoot/photon/releases/download/1.3.0/photon-1.3.0.jar',
      );
      expect(dockerfile).toContain(
        'a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5  /engine.jar',
      );
      expect(dockerfile).toContain('= "98219380"');
      expect(dockerfile).toContain(
        'COPY infra/images/search/licenses/ /opt/atlas-os/engine/licenses/',
      );
    }
    expect(serving).toContain(
      'node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b',
    );
    expect(serving).toContain(
      'eclipse-temurin:21.0.12_8-jre-noble@sha256:7739f0ffce786528961eea6bf46d9610ee968ac6127c9b2e93494757bdecce9f',
    );

    // System packages come from one dated snapshot, each at an exact version.
    expect(provisioning).toMatch(/^ARG UBUNTU_SNAPSHOT=\d{8}T\d{6}Z$/m);
    const installs = provisioning.slice(provisioning.indexOf('apt-get install'));
    const packages = [...installs.matchAll(/^ {4}([a-z0-9.+-]+)(=\S+)? \\$/gm)];
    expect(packages.length).toBeGreaterThan(10);
    for (const [, name, version] of packages) {
      expect(version, name).toMatch(/^=[\w.:~+-]+$/);
    }
  });

  it('retains the pinned licence texts for bundled engine components', () => {
    const sourceDigests = {
      'args4j-2.33.LICENSE.txt': 'a68bec3102486fec043d2171ac82895202e5ccca7dfd265ac60403e0b27ea458',
      'jopt-simple-5.0.4.LICENSE.txt':
        '91d37fd637f457bd1f95b288f8eb6d33df6ea9de7a76e766ec8cf71f2bf71406',
      'jzlib-1.1.3.LICENSE.txt': '5fa73d69e1b4138fa344c1ad3fe9a6f9e0b412756c7be6807b24110b41b4a75a',
      'protobuf-java-3.25.8.LICENSE':
        '6e5e117324afd944dcf67f36cf329843bc1a92229a8cd9bb573d7a83130fea7d',
      'reactive-streams-1.0.4.LICENSE':
        '96a3b2d45af72054d0676e8eb9a944a096812a7f8ff1b71bd82dadbc60ce0444',
      'zstd-jni-1.5.6-1.LICENSE':
        'c6a6a8926f2f1732603e4b75779a5f6ce79238eb79bc36dcc5b7feb509bc6cd9',
      'jts-1.20.0/LICENSES.txt': 'dc8145c6d2a95160b8e9a49a4b080552bd821fff1879fcabc32416d583997041',
      'jts-1.20.0/LICENSE_EDLv1.txt':
        'e67a91b5489cd78292d2654f1b587fe68296e28df7c766b9b675614fbdce4fd1',
      'jts-1.20.0/LICENSE_EPLv2.txt':
        '8c349f80764d0648e645f41ef23772a70c995a0924b5235f735f4a3d09df127c',
      'jts-1.20.0/OSGEO_LICENSE.txt':
        '4f8fc9d0a3fccd751f9ba025de07896c9aa2ef49c7eb16addf4dc021f06ba64a',
      'jakarta.servlet-api-6.0.0/LICENSE.txt':
        '2bfa89e57dd3034b419eea6d273ac79d7006c88c5bef6bc7df4aea0dfc355716',
      'jakarta.servlet-api-6.0.0/NOTICE.txt':
        '6cf6b2dbeb627d0bb755764e4caacb75f9dcf280f75f2a56764d31b12e2261f8',
    };
    const notices = repositoryFile('infra/images/search/licenses/THIRD_PARTY_NOTICES.md');
    for (const [filename, digest] of Object.entries(sourceDigests)) {
      const content = readFileSync(
        new URL(`../../infra/images/search/licenses/components/${filename}`, import.meta.url),
      );
      expect(createHash('sha256').update(content).digest('hex'), filename).toBe(digest);
      expect(notices, filename).toContain(digest);
    }
    expect(notices).toContain('`com.googlecode.json-simple:json-simple`');
    expect(notices).not.toContain('none declared in its POM');
    expect(notices).toContain('Including the alternatives does not elect one');
  });

  it('installs every Python package for the database build by hash', () => {
    for (const lock of [
      'infra/images/search-build/requirements.lock',
      'infra/images/search-build/build-backend.lock',
    ]) {
      const requirements = repositoryFile(lock)
        .split(/\n(?! )/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && !entry.startsWith('#'));
      expect(requirements.length, lock).toBeGreaterThan(0);
      for (const requirement of requirements) {
        expect(requirement, lock).toMatch(/^[A-Za-z0-9._-]+==[\w.]+ \\\n?/);
        expect(requirement, lock).toMatch(/--hash=sha256:[a-f0-9]{64}/);
      }
    }
    const lock = repositoryFile('infra/images/search-build/requirements.lock');
    expect(lock).toMatch(/^nominatim-db==5\.3\.2 /m);
    const dockerfile = repositoryFile('infra/images/search-build.Dockerfile');
    expect(dockerfile.match(/--require-hashes --no-deps/g)).toHaveLength(2);
  });

  it('pins every direct dependency to an exact version', () => {
    for (const manifest of [
      'package.json',
      'apps/api/package.json',
      'apps/cli/package.json',
      'apps/search-host/package.json',
      'apps/updater/package.json',
      'apps/web/package.json',
      'packages/core/package.json',
      'packages/atlas-os/package.json',
    ]) {
      const parsed = JSON.parse(repositoryFile(manifest)) as Record<
        string,
        Record<string, string> | undefined
      >;
      for (const field of ['dependencies', 'devDependencies'] as const) {
        for (const [name, range] of Object.entries(parsed[field] ?? {})) {
          if (range.startsWith('workspace:')) continue;
          expect(range, `${manifest} ${field} ${name}`).toMatch(/^\d+\.\d+\.\d+/);
        }
      }
    }
  });
});
