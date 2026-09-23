import type { StyleSpecification } from 'maplibre-gl';

/**
 * Renderer-specific adaptation of the basemap style document.
 *
 * The API publishes origin-relative resource paths, which is what keeps the descriptor portable:
 * the same snapshot is served correctly whatever host or port the gateway is reached on, and no
 * origin is ever baked into stored data. The renderer, however, requires an absolute sprite URL.
 * Resolving those paths against the current origin is therefore done here, in the application
 * that owns the renderer, rather than in the contract.
 *
 * Absolute URLs are built by concatenation rather than with `URL`, because the glyph template
 * contains `{fontstack}` and `{range}` placeholders that percent-encoding would destroy.
 */
export function absolutizeStyleUrls(style: StyleSpecification, origin: string): StyleSpecification {
  const absolute = (value: string): string => (value.startsWith('/') ? `${origin}${value}` : value);

  const sources = Object.fromEntries(
    Object.entries(style.sources).map(([id, source]) => {
      if (!('url' in source) || typeof source.url !== 'string') return [id, source];
      const [scheme, rest] = splitScheme(source.url);
      return [
        id,
        { ...source, url: scheme === undefined ? absolute(rest) : `${scheme}${absolute(rest)}` },
      ];
    }),
  );

  return {
    ...style,
    ...(style.glyphs === undefined ? {} : { glyphs: absolute(style.glyphs) }),
    ...(typeof style.sprite === 'string' ? { sprite: absolute(style.sprite) } : {}),
    sources,
  };
}

/** Splits `pmtiles:///maps/x` into its scheme prefix and the path that follows it. */
function splitScheme(url: string): [string | undefined, string] {
  const marker = '://';
  const index = url.indexOf(marker);
  if (index === -1) return [undefined, url];
  return [url.slice(0, index + marker.length), url.slice(index + marker.length)];
}

export async function loadStyleDocument(
  styleUrl: string,
  origin: string,
  signal: AbortSignal,
): Promise<StyleSpecification> {
  const response = await fetch(styleUrl, { headers: { accept: 'application/json' }, signal });
  if (!response.ok) {
    throw new Error(`Basemap style returned HTTP ${response.status}.`);
  }
  return absolutizeStyleUrls((await response.json()) as StyleSpecification, origin);
}
