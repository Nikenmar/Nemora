import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

// Hand-written until the bindings generated from Rust replace it (P3).
interface CoreInfo {
  coreVersion: string;
  identityAlgorithm: string;
  profileDir: string;
}

export default function App() {
  const [info, setInfo] = useState<CoreInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<CoreInfo>('core_info').then(setInfo, (e) => setError(String(e)));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, color: '#e8e8ea', background: '#212226', minHeight: '100vh' }}>
      <h1 style={{ marginTop: 0 }}>Nemora 2.0</h1>
      <p>Foundation build. The view arrives page by page in P3.</p>
      {error && <p>Core unavailable: {error}</p>}
      {info && (
        <dl>
          <dt>Core</dt>
          <dd>{info.coreVersion}</dd>
          <dt>Track identity</dt>
          <dd>{info.identityAlgorithm}</dd>
          <dt>Profile</dt>
          <dd>{info.profileDir}</dd>
        </dl>
      )}
    </main>
  );
}
