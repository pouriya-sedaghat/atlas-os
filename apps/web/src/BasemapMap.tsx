import type { BasemapDescriptor } from '@atlas-os/core';
import type {
  DataDrivenPropertyValueSpecification,
  ErrorEvent as MapErrorEvent,
} from 'maplibre-gl';
import { Map as MapLibreMap, NavigationControl, ScaleControl } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';

import { registerArchiveProtocol } from './pmtiles-protocol.js';
import { ensureRtlTextPlugin } from './rtl-text.js';
import { configureRendererWorker } from './renderer-worker.js';
import { loadStyleDocument } from './style-document.js';

export type LabelLanguage = string;

type ReadyBasemap = Extract<BasemapDescriptor, { availability: 'ready' }>;

export interface BasemapMapProps {
  readonly descriptor: ReadyBasemap;
  readonly language: LabelLanguage;
}

/** Layer identifiers currently producing geometry, reported for operator diagnostics. */
function renderedLayerIds(map: MapLibreMap): readonly string[] {
  return [...new Set(map.queryRenderedFeatures().map((feature) => feature.layer.id))].sort();
}

/** Ordered language preference for label text, with the selected language first. */
function labelPreference(descriptor: ReadyBasemap, language: LabelLanguage): readonly string[] {
  return [language, ...descriptor.labelLanguages.filter((item) => item !== language)];
}

function labelExpression(
  languages: readonly string[],
): DataDrivenPropertyValueSpecification<string> {
  return [
    'coalesce',
    ...languages.map((code) => ['get', `name:${code}`]),
    ['get', 'name'],
  ] as unknown as DataDrivenPropertyValueSpecification<string>;
}

export function BasemapMap({ descriptor, language }: BasemapMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [renderedLayers, setRenderedLayers] = useState<readonly string[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    configureRendererWorker();
    const releaseProtocol = registerArchiveProtocol();
    const abort = new AbortController();
    let map: MapLibreMap | undefined;

    // Both the style and right-to-left shaping must be ready before the map is constructed: the
    // style because its origin-relative resource paths have to be resolved for the renderer, and
    // the shaping plugin because a map built before it is registered renders Persian labels
    // unshaped. Awaiting both is what makes the outcome deterministic across remounts.
    Promise.all([
      loadStyleDocument(descriptor.styleDescriptorUrl, globalThis.location.origin, abort.signal),
      ensureRtlTextPlugin(),
    ])
      .then(([style]) => {
        if (abort.signal.aborted) return;
        map = new MapLibreMap({
          // Always expanded: the basemap's attribution is a licence obligation, so it must be
          // visible rather than hidden behind a control the viewer has to open. The links it
          // contains are navigational; nothing fetches them while rendering.
          attributionControl: { compact: false },
          bounds: [
            [descriptor.bounds.west, descriptor.bounds.south],
            [descriptor.bounds.east, descriptor.bounds.north],
          ],
          container,
          fitBoundsOptions: { padding: 24 },
          maxZoom: descriptor.maxZoom,
          minZoom: descriptor.minZoom,
          style,
        });
        mapRef.current = map;

        map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
        map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

        map.on('load', () => setStatus('ready'));
        map.on('error', (event: MapErrorEvent) => {
          setStatus('error');
          setMessage(event.error?.message ?? 'The basemap failed to load.');
        });
        // Reported once the renderer has finished drawing, so the panel shows what is actually
        // on screen at the current view rather than what the style declares.
        map.on('idle', () => setRenderedLayers(renderedLayerIds(map!)));
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : String(error));
      });

    return () => {
      abort.abort();
      // Remove the renderer before releasing the protocol, so no in-flight tile request
      // outlives its handler during a development remount.
      map?.remove();
      mapRef.current = null;
      releaseProtocol();
    };
  }, [descriptor]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || status !== 'ready') return;
    const expression = labelExpression(labelPreference(descriptor, language));
    for (const layer of map.getStyle().layers) {
      if (layer.type !== 'symbol') continue;
      map.setLayoutProperty(layer.id, 'text-field', expression);
    }
  }, [descriptor, language, status]);

  return (
    <div className="map-shell">
      <div
        className="map-canvas"
        data-label-language={language}
        data-rendered-layers={renderedLayers.join(',')}
        data-testid="map-container"
        ref={containerRef}
      />
      {status === 'loading' && (
        <p className="map-overlay" data-testid="map-loading">
          Loading basemap…
        </p>
      )}
      {status === 'error' && (
        <p className="map-overlay error" data-testid="map-error">
          {message}
        </p>
      )}
      <span data-testid="map-status" hidden>
        {status}
      </span>
      {renderedLayers.length > 0 && (
        <p className="map-layers" data-testid="map-rendered-layers">
          Rendering: {renderedLayers.join(', ')}
        </p>
      )}
    </div>
  );
}
