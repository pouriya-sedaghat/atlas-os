import { Agent, request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';

import type { EngineCollection } from './mapping.js';
import { engineCollectionSchema } from './mapping.js';
import type { HostStatus } from './protocol.js';
import { HOST_ROUTES, MAX_ENGINE_RESPONSE_BYTES, hostStatusSchema } from './protocol.js';

/**
 * Outcome of one call to a search engine host.
 *
 * Every failure mode is a value: the caller maps each to a typed, provider-neutral outcome and
 * never sees a socket error, a raw body or a stack trace.
 */
export type HostCallResult<T> =
  | { readonly kind: 'ok'; readonly value: T; readonly headers: IncomingHttpHeaders }
  | { readonly kind: 'unavailable'; readonly status: HostStatus | null }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'failed' };

export interface HostClientOptions {
  readonly statusTimeoutMs: number;
  readonly queryTimeoutMs: number;
}

export const DEFAULT_HOST_CLIENT_OPTIONS: HostClientOptions = {
  queryTimeoutMs: 2_000,
  statusTimeoutMs: 500,
};

interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

type RawResult =
  | { readonly kind: 'response'; readonly response: RawResponse }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'too_large' };

export class EngineHostClient {
  readonly #options: HostClientOptions;
  readonly #agent = new Agent({ keepAlive: true, maxSockets: 64 });

  constructor(options: HostClientOptions = DEFAULT_HOST_CLIENT_OPTIONS) {
    this.#options = options;
  }

  close(): void {
    this.#agent.destroy();
  }

  async status(base: URL): Promise<HostCallResult<HostStatus>> {
    const raw = await this.#get(new URL(HOST_ROUTES.status, base), this.#options.statusTimeoutMs);
    if (raw.kind !== 'response') return raw.kind === 'too_large' ? { kind: 'failed' } : raw;
    if (raw.response.status !== 200) return { kind: 'failed' };
    const status = parseJson(raw.response.body, (value) => hostStatusSchema.safeParse(value));
    return status === undefined
      ? { kind: 'failed' }
      : { headers: raw.response.headers, kind: 'ok', value: status };
  }

  async query(
    base: URL,
    route: 'search' | 'reverse',
    parameters: Readonly<Record<string, string>>,
  ): Promise<HostCallResult<EngineCollection>> {
    const url = new URL(HOST_ROUTES[route], base);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const raw = await this.#get(url, this.#options.queryTimeoutMs);
    if (raw.kind !== 'response') return raw.kind === 'too_large' ? { kind: 'failed' } : raw;
    const { response } = raw;
    if (response.status === 503) {
      const status = parseJson(response.body, (value) => hostStatusSchema.safeParse(value));
      return { kind: 'unavailable', status: status ?? null };
    }
    if (response.status !== 200) return { kind: 'failed' };
    const collection = parseJson(response.body, (value) => engineCollectionSchema.safeParse(value));
    return collection === undefined
      ? { kind: 'failed' }
      : { headers: response.headers, kind: 'ok', value: collection };
  }

  #get(url: URL, timeoutMs: number): Promise<RawResult> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: RawResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const request = httpRequest(
        url,
        { agent: this.#agent, headers: { accept: 'application/json' }, method: 'GET' },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_ENGINE_RESPONSE_BYTES) {
              request.destroy();
              finish({ kind: 'too_large' });
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () =>
            finish({
              kind: 'response',
              response: {
                body: Buffer.concat(chunks),
                headers: response.headers,
                status: response.statusCode ?? 0,
              },
            }),
          );
          response.on('error', () => finish({ kind: 'unreachable' }));
        },
      );
      const timer = setTimeout(() => {
        request.destroy();
        finish({ kind: 'timeout' });
      }, timeoutMs);
      request.on('error', () => finish({ kind: 'unreachable' }));
      request.end();
    });
  }
}

function parseJson<T>(
  body: Buffer,
  parse: (value: unknown) => { success: true; data: T } | { success: false },
): T | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
  const result = parse(value);
  return result.success ? result.data : undefined;
}
