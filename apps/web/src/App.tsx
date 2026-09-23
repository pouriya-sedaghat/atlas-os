import { useEffect, useMemo, useState } from 'react';

import type { PlatformSnapshot } from './api.js';
import { readPlatformSnapshot } from './api.js';
import { BasemapMap } from './BasemapMap.js';

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

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ state: 'loading' });
  const [language, setLanguage] = useState('fa');

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
  }, []);

  const basemap = loadState.state === 'ready' ? loadState.value.basemap : undefined;
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
          <BasemapMap descriptor={basemap} language={language} />
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
