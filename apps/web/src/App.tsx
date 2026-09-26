import type { PlaceAttribution, PlaceResult, SearchLanguage } from '@atlas-os/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PlaceAnswer, PlatformSnapshot } from './api.js';
import { describePoint, readPlatformSnapshot } from './api.js';
import type { MapControls, MapCoordinate, MapSelection } from './BasemapMap.js';
import { BasemapMap } from './BasemapMap.js';
import { AttributionNote, MESSAGES, PlaceSearch, addressLine } from './PlaceSearch.js';

type LoadState =
  | { readonly state: 'loading' }
  | { readonly state: 'error'; readonly message: string }
  | { readonly state: 'ready'; readonly value: PlatformSnapshot };

function StatusCard({ title, value }: { readonly title: string; readonly value: unknown }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

function capabilitySummary(snapshot: PlatformSnapshot): readonly string[] {
  return Object.entries(snapshot.capabilities.features)
    .filter(([, state]) => !state.available)
    .map(([name]) => name);
}

const REVERSE_MESSAGES: Readonly<
  Record<SearchLanguage, { readonly pick: string; readonly centre: string; readonly none: string }>
> = {
  en: {
    centre: 'Describe map centre',
    none: 'Nothing is recorded at this point.',
    pick: 'Describe a point on the map',
  },
  fa: {
    centre: 'توصیف مرکز نقشه',
    none: 'در این نقطه چیزی ثبت نشده است.',
    pick: 'توصیف یک نقطه روی نقشه',
  },
};

type Described =
  | { readonly state: 'idle' }
  | { readonly state: 'describing' }
  | {
      readonly state: 'described';
      readonly place: PlaceResult | null;
      readonly attribution: PlaceAttribution;
    }
  | { readonly state: 'message'; readonly message: string };

function searchLanguage(language: string): SearchLanguage {
  return language === 'en' ? 'en' : 'fa';
}

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ state: 'loading' });
  const [language, setLanguage] = useState('fa');
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [picking, setPicking] = useState(false);
  const [described, setDescribed] = useState<Described>({ state: 'idle' });
  const controls = useRef<MapControls | null>(null);
  const describeSequence = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    readPlatformSnapshot(controller.signal).then(
      (value) => setLoadState({ state: 'ready', value }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadState({ message: String(error), state: 'error' });
      },
    );
    return () => controller.abort();
  }, [refresh]);

  // An answer from another snapshot means the dataset changed under the page: re-read it.
  const onSnapshotChanged = useCallback(() => {
    setSelection(null);
    setDescribed({ state: 'idle' });
    setRefresh((value) => value + 1);
  }, []);

  const select = useCallback((place: PlaceResult) => {
    setSelection((previous) => ({
      bounds: place.bounds,
      coordinate: place.coordinate,
      key: (previous?.key ?? 0) + 1,
      kind: place.kind,
      name: place.name,
    }));
  }, []);

  const basemap = loadState.state === 'ready' ? loadState.value.basemap : undefined;
  const searchCapability =
    loadState.state === 'ready' ? loadState.value.capabilities.features.search : undefined;
  // Disabled only when the dataset has no search at all; a starting engine still takes queries
  // and answers truthfully that it is starting.
  const searchInstalled =
    searchCapability !== undefined &&
    (searchCapability.available || searchCapability.reason !== 'not_installed');
  const activeSnapshot = basemap?.availability === 'ready' ? basemap.snapshotId : null;
  const placeLanguage = searchLanguage(language);

  const describe = useCallback(
    (coordinate: MapCoordinate) => {
      if (activeSnapshot === null) return;
      const ticket = (describeSequence.current += 1);
      setPicking(false);
      setDescribed({ state: 'describing' });
      const done = (answer: PlaceAnswer) => {
        if (ticket !== describeSequence.current) return;
        if (answer.kind !== 'ok') {
          const text = MESSAGES[placeLanguage];
          setDescribed({
            message:
              answer.kind === 'unavailable'
                ? answer.reason === 'starting'
                  ? text.starting
                  : answer.reason === 'not_installed' || answer.reason === 'component_missing'
                    ? text.notInstalled
                    : text.unavailable
                : text.failed,
            state: 'message',
          });
          return;
        }
        if (answer.snapshotId !== activeSnapshot) {
          onSnapshotChanged();
          return;
        }
        const place = answer.results[0] ?? null;
        setDescribed({ attribution: answer.attribution, place, state: 'described' });
        if (place !== null) select(place);
      };
      describePoint(coordinate, placeLanguage, new AbortController().signal).then(done, () =>
        done({ kind: 'failed' }),
      );
    },
    [activeSnapshot, onSnapshotChanged, placeLanguage, select],
  );

  const unavailable = useMemo(
    () => (loadState.state === 'ready' ? capabilitySummary(loadState.value) : []),
    [loadState],
  );

  return (
    <main>
      <header>
        <p className="eyebrow">OFFLINE-FIRST · SELF-HOSTED</p>
        <h1>atlas-os</h1>
        <p>
          The local control plane and the vector basemap are served from this host. Nothing on this
          page is fetched from an external origin.
        </p>
      </header>

      {loadState.state === 'loading' && (
        <p className="notice" data-testid="app-loading">
          Loading local service status…
        </p>
      )}
      {loadState.state === 'error' && (
        <p className="notice error" data-testid="app-error">
          Local API unavailable: {loadState.message}
        </p>
      )}

      {basemap !== undefined && basemap.availability === 'ready' && (
        <section className="map-section" data-testid="map-section">
          <div className="map-toolbar">
            <h2>Basemap</h2>
            <div className="language-toggle" role="group" aria-label="Label language">
              {basemap.labelLanguages.map((code) => (
                <button
                  aria-pressed={language === code}
                  className={language === code ? 'active' : ''}
                  data-testid={`language-${code}`}
                  key={code}
                  onClick={() => setLanguage(code)}
                  type="button"
                >
                  {code === 'fa' ? 'فارسی' : code.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <PlaceSearch
            installed={searchInstalled}
            language={placeLanguage}
            onSelect={select}
            onSnapshotChanged={onSnapshotChanged}
            snapshotId={basemap.snapshotId}
          />
          <div
            className="reverse-actions"
            role="group"
            aria-label={REVERSE_MESSAGES[placeLanguage].pick}
          >
            <button
              aria-pressed={picking}
              className={picking ? 'active' : ''}
              data-testid="reverse-pick"
              disabled={!searchInstalled}
              onClick={() => setPicking((value) => !value)}
              type="button"
            >
              {REVERSE_MESSAGES[placeLanguage].pick}
            </button>
            <button
              data-testid="reverse-centre"
              disabled={!searchInstalled}
              onClick={() => {
                const centre = controls.current?.center();
                if (centre !== undefined) describe(centre);
              }}
              type="button"
            >
              {REVERSE_MESSAGES[placeLanguage].centre}
            </button>
          </div>
          <BasemapMap
            descriptor={basemap}
            language={language}
            onPick={describe}
            onReady={(value) => {
              controls.current = value;
            }}
            picking={picking}
            selection={selection}
          />
          <section
            aria-live="polite"
            className="reverse-result"
            data-testid="reverse-result"
            dir="auto"
            lang={placeLanguage}
          >
            {described.state === 'describing' && <p>{MESSAGES[placeLanguage].searching}</p>}
            {described.state === 'message' && <p>{described.message}</p>}
            {described.state === 'described' && (
              <>
                {described.place === null ? (
                  <p>{REVERSE_MESSAGES[placeLanguage].none}</p>
                ) : (
                  <p data-place-id={described.place.id}>
                    <strong>{described.place.name}</strong>{' '}
                    <span>{addressLine(described.place)}</span>
                  </p>
                )}
                <AttributionNote attribution={described.attribution} />
              </>
            )}
          </section>
          <p className="map-meta" data-testid="map-meta">
            Snapshot <code>{basemap.snapshotId}</code> · {basemap.vectorFormat.toUpperCase()} in{' '}
            {basemap.mediaType} · zoom {basemap.minZoom}–{basemap.maxZoom}
          </p>
        </section>
      )}

      {basemap !== undefined && basemap.availability === 'not_installed' && (
        <section className="notice" data-testid="basemap-unavailable">
          <h2>No basemap installed</h2>
          <p>
            No dataset has been provisioned on this host yet, so there is nothing to render. The
            application is healthy and the status below is live. An operator provisions a basemap
            with the command-line tool; see the data lifecycle documentation.
          </p>
        </section>
      )}

      {basemap !== undefined && basemap.availability === 'unavailable' && (
        <section className="notice error" data-testid="basemap-degraded">
          <h2>Basemap unavailable</h2>
          <p>
            A dataset is installed on this host but cannot be served: {basemap.detail} The
            application remains healthy and the status below is live. Validate the snapshot, or roll
            back to the previous one, with the command-line tool.
          </p>
          <p className="map-meta">
            Reason code <code data-testid="basemap-degraded-reason">{basemap.reason}</code>
          </p>
        </section>
      )}

      {loadState.state === 'ready' && (
        <>
          <div className="grid">
            <StatusCard title="API health" value={loadState.value.health} />
            <StatusCard title="Readiness" value={loadState.value.readiness} />
            <StatusCard title="Dataset" value={loadState.value.dataset} />
            <StatusCard title="Basemap" value={loadState.value.basemap} />
          </div>
          <p className="notice" data-testid="capabilities-summary">
            Not installed on this host: {unavailable.join(', ')}.
          </p>
        </>
      )}
    </main>
  );
}
