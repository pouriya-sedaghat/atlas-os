import type { BasemapDescriptor, GeographicBounds, PlaceKind } from '@atlas-os/core';
import type {
  DataDrivenPropertyValueSpecification,
  ErrorEvent as MapErrorEvent,
} from 'maplibre-gl';
import { Map as MapLibreMap, Marker, NavigationControl, ScaleControl } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';

import { registerArchiveProtocol } from './pmtiles-protocol.js';
import { ensureRtlTextPlugin } from './rtl-text.js';
import { configureRendererWorker } from './renderer-worker.js';
import { loadStyleDocument } from './style-document.js';

export type LabelLanguage = string;

type ReadyBasemap = Extract<BasemapDescriptor, { availability: 'ready' }>;

export interface MapCoordinate {
  readonly latitude: number;
  readonly longitude: number;
}

/** A place to show on the map. `key` changes whenever the same place is chosen again. */
export interface MapSelection {
  readonly key: number;
  readonly name: string;
  readonly coordinate: MapCoordinate;
  readonly bounds?: GeographicBounds | undefined;
  readonly kind?: PlaceKind | undefined;
}

export interface MapControls {
  center(): MapCoordinate;
}

export interface BasemapMapProps {
  readonly descriptor: ReadyBasemap;
  readonly language: LabelLanguage;
  readonly selection?: MapSelection | null;
  /** While true, a click on the map picks that point instead of panning. */
  readonly picking?: boolean;
  readonly onPick?: (coordinate: MapCoordinate) => void;
  readonly onReady?: (controls: MapControls) => void;
}

/** How close to fly for each kind of place, when there is no extent to fit. */
const KIND_ZOOM: Readonly<Record<PlaceKind, number>> = {
  city: 11,
  country: 5,
  county: 9,
  district: 13,
  house: 17,
  locality: 14,
  other: 15,
  state: 7,
  street: 16,
};

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** A plain, accessible DOM marker: no image, nothing fetched. */
function markerElement(name: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'place-marker';
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', name);
  element.dataset['testid'] = 'place-marker';
  element.title = name;
  return element;
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

export function BasemapMap({
  descriptor,
  language,
  onPick,
  onReady,
  picking = false,
  selection = null,
}: BasemapMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const pickingRef = useRef(picking);
  const onPickRef = useRef(onPick);
  const onReadyRef = useRef(onReady);
  pickingRef.current = picking;
  onPickRef.current = onPick;
  onReadyRef.current = onReady;
  const [camera, setCamera] = useState<'moving' | 'idle'>('idle');
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

        map.on('load', () => {
          setStatus('ready');
          onReadyRef.current?.({
            center: () => {
              const center = map!.getCenter();
              return { latitude: center.lat, longitude: center.lng };
            },
          });
        });
        map.on('movestart', () => setCamera('moving'));
        map.on('moveend', () => setCamera('idle'));
        map.on('click', (event) => {
          if (!pickingRef.current) return;
          onPickRef.current?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
        });
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
      markerRef.current?.remove();
      markerRef.current = null;
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

  // Show a chosen place: fit its extent, or fly to a zoom that suits its kind, and mark it.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || status !== 'ready' || selection === null) return;
    const center: [number, number] = [
      selection.coordinate.longitude,
      selection.coordinate.latitude,
    ];
    const animate = !prefersReducedMotion();
    const { bounds } = selection;
    if (bounds !== undefined && selection.kind !== 'house') {
      map.fitBounds(
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ],
        { animate, maxZoom: 16, padding: 48 },
      );
    } else {
      const zoom = Math.min(KIND_ZOOM[selection.kind ?? 'other'], descriptor.maxZoom + 3);
      if (animate) map.flyTo({ center, essential: true, zoom });
      else map.jumpTo({ center, zoom });
    }
    markerRef.current?.remove();
    markerRef.current = new Marker({ element: markerElement(selection.name) })
      .setLngLat(center)
      .addTo(map);
  }, [descriptor, selection, status]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas !== undefined) canvas.style.cursor = picking ? 'crosshair' : '';
  }, [picking, status]);

  return (
    <div className="map-shell">
      <div
        className="map-canvas"
        data-camera={camera}
        data-picking={picking ? 'true' : 'false'}
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
