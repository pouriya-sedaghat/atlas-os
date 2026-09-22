import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

interface ApiState {
  readonly health: unknown;
  readonly readiness: unknown;
  readonly dataset: unknown;
  readonly capabilities: unknown;
}

type LoadState =
  | { readonly state: 'loading' }
  | { readonly state: 'error'; readonly message: string }
  | { readonly state: 'ready'; readonly value: ApiState };

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Local API returned HTTP ${response.status}.`);
  }
  return response.json();
}

function StatusCard({ title, value }: { readonly title: string; readonly value: unknown }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

function App() {
  const [loadState, setLoadState] = useState<LoadState>({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      readJson('/api/health'),
      readJson('/api/ready'),
      readJson('/api/v1/dataset'),
      readJson('/api/v1/capabilities'),
    ]).then(
      ([health, readiness, dataset, capabilities]) => {
        if (!controller.signal.aborted) {
          setLoadState({
            state: 'ready',
            value: { capabilities, dataset, health, readiness },
          });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadState({ state: 'error', message: String(error) });
        }
      },
    );
    return () => controller.abort();
  }, []);

  return (
    <main>
      <header>
        <p className="eyebrow">OFFLINE-FIRST · MILESTONE M0</p>
        <h1>atlas-os foundation</h1>
        <p>
          The local control plane is running. Geospatial capabilities and datasets are not installed
          in M0.
        </p>
      </header>
      {loadState.state === 'loading' && <p className="notice">Loading local service status…</p>}
      {loadState.state === 'error' && (
        <p className="notice error">Local API unavailable: {loadState.message}</p>
      )}
      {loadState.state === 'ready' && (
        <div className="grid">
          <StatusCard title="API health" value={loadState.value.health} />
          <StatusCard title="Readiness" value={loadState.value.readiness} />
          <StatusCard title="Dataset" value={loadState.value.dataset} />
          <StatusCard title="Capabilities" value={loadState.value.capabilities} />
        </div>
      )}
    </main>
  );
}

const rootElement = document.querySelector('#root');
if (rootElement === null) {
  throw new Error('Root element not found.');
}
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
