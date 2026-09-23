/**
 * Result of interpreting a `Range` request header against a known resource size.
 *
 * `ignored` and `unsatisfiable` are distinct on purpose: RFC 9110 requires a server to ignore a
 * malformed or unsupported range and answer with the whole representation, but to answer 416
 * when the range is well formed and simply cannot be met.
 */
export type ParsedRange =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'satisfiable'; readonly start: number; readonly end: number }
  | { readonly kind: 'unsatisfiable' };

const singleRangePattern = /^bytes=(\d*)-(\d*)$/;

/**
 * Parses a single-range `bytes` header.
 *
 * Multi-range requests are answered with the full representation rather than a multipart body,
 * which a server is permitted to do and which keeps the response path a single bounded stream.
 */
export function parseRangeHeader(header: string | undefined, size: number): ParsedRange {
  if (header === undefined) return { kind: 'ignored' };

  const value = header.trim();
  if (!value.startsWith('bytes=')) return { kind: 'ignored' };
  if (value.includes(',')) return { kind: 'ignored' };

  const match = singleRangePattern.exec(value);
  if (match === null) return { kind: 'ignored' };

  const [, rawStart = '', rawEnd = ''] = match;
  if (rawStart === '' && rawEnd === '') return { kind: 'ignored' };

  if (rawStart === '') {
    // Suffix form: the last N bytes. A zero-length suffix cannot be satisfied.
    const suffixLength = Number(rawEnd);
    if (suffixLength === 0) return { kind: 'unsatisfiable' };
    if (size === 0) return { kind: 'unsatisfiable' };
    const start = Math.max(0, size - suffixLength);
    return { end: size - 1, kind: 'satisfiable', start };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start >= size) return { kind: 'unsatisfiable' };

  if (rawEnd === '') return { end: size - 1, kind: 'satisfiable', start };

  const requestedEnd = Number(rawEnd);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return { kind: 'unsatisfiable' };
  return { end: Math.min(requestedEnd, size - 1), kind: 'satisfiable', start };
}

export function contentRange(start: number, end: number, size: number): string {
  return `bytes ${start}-${end}/${size}`;
}

export function unsatisfiedContentRange(size: number): string {
  return `bytes */${size}`;
}
