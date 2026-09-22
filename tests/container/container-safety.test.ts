import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkComposeNetworkPolicy,
  checkContainerSafety,
  checkNginxRuntimeConfig,
  isForbiddenBuildContextPath,
  requiredNginxRuntimeDirectives,
} from '../../scripts/container-safety.mjs';

function changeServiceBlock(compose: string, service: string, change: (block: string) => string) {
  const marker = `  ${service}:\n`;
  const start = compose.indexOf(marker);
  const remainderStart = start + marker.length;
  const relativeEnd = compose.slice(remainderStart).search(/\n {2}[a-z][\w-]*:\n/);
  const blockEnd = relativeEnd === -1 ? compose.length : remainderStart + relativeEnd;
  return `${compose.slice(0, start)}${change(compose.slice(start, blockEnd))}${compose.slice(blockEnd)}`;
}

describe('container context and runtime safety', () => {
  it('excludes local environment and review artifacts while preserving the example', () => {
    expect(isForbiddenBuildContextPath('.env')).toBe(true);
    expect(isForbiddenBuildContextPath('.env.production')).toBe(true);
    expect(isForbiddenBuildContextPath('apps/api/.env.local')).toBe(true);
    expect(isForbiddenBuildContextPath('.validation/web-dist/app.js')).toBe(true);
    expect(isForbiddenBuildContextPath('review.patch')).toBe(true);
    expect(isForbiddenBuildContextPath('atlas-os.diff')).toBe(true);
    expect(isForbiddenBuildContextPath('.env.example')).toBe(false);
  });

  it('enforces minimal production runtime stages and package payloads', async () => {
    await expect(checkContainerSafety()).resolves.toBeUndefined();
  });

  it('enforces the private runtime and loopback edge network topology', async () => {
    const compose = (await readFile(resolve('infra/compose/compose.yaml'), 'utf8')).replaceAll(
      '\r\n',
      '\n',
    );
    expect(() => checkComposeNetworkPolicy(compose)).not.toThrow();

    const gatewayWithoutEdge = compose.replace(
      '    networks:\n      - edge\n      - runtime',
      '    networks:\n      - runtime',
    );
    expect(() => checkComposeNetworkPolicy(gatewayWithoutEdge)).toThrow(
      'Compose gateway service must attach only to edge and runtime.',
    );

    for (const service of ['api', 'web', 'updater']) {
      const backendOnEdge = changeServiceBlock(compose, service, (block) =>
        block.replace('    networks: [runtime]', '    networks: [runtime, edge]'),
      );
      expect(() => checkComposeNetworkPolicy(backendOnEdge)).toThrow(
        `Compose ${service} service must attach only to runtime.`,
      );
    }

    const publicGateway = compose.replace(
      "      - '127.0.0.1:${ATLAS_GATEWAY_PORT:-8080}:8080'",
      "      - '${ATLAS_GATEWAY_PORT:-8080}:8080'",
    );
    expect(() => checkComposeNetworkPolicy(publicGateway)).toThrow(
      'Compose gateway port must publish only on 127.0.0.1.',
    );

    const publicRuntime = compose.replace('    internal: true\n', '');
    expect(() => checkComposeNetworkPolicy(publicRuntime)).toThrow(
      'Compose runtime network must remain internal.',
    );

    const internalEdge = compose.replace(
      '  edge:\n    driver: bridge',
      '  edge:\n    internal: true\n    driver: bridge',
    );
    expect(() => checkComposeNetworkPolicy(internalEdge)).toThrow(
      'Compose edge network must not be internal.',
    );

    const apiWithPort = changeServiceBlock(compose, 'api', (block) =>
      block.replace(
        '    networks: [runtime]',
        "    networks: [runtime]\n    ports:\n      - '127.0.0.1:3000:3000'",
      ),
    );
    expect(() => checkComposeNetworkPolicy(apiWithPort)).toThrow(
      'Compose api service must not publish ports.',
    );
  });

  for (const configPath of ['infra/images/web-nginx.conf', 'infra/gateway/nginx.conf']) {
    it(`${configPath} requires every read-only nginx runtime path`, async () => {
      const configuration = await readFile(resolve(configPath), 'utf8');
      expect(() => checkNginxRuntimeConfig(configuration, configPath)).not.toThrow();

      for (const directive of requiredNginxRuntimeDirectives) {
        const incompleteConfiguration = configuration.replace(directive, '');
        expect(() => checkNginxRuntimeConfig(incompleteConfiguration, configPath)).toThrow(
          `${configPath} is missing required runtime directive: ${directive}`,
        );
      }
    });
  }
});
