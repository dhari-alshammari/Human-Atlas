'use client';

import { useEffect, useMemo, useState } from 'react';
import AnatomyScene from './scene';
import {
  defaultVisible,
  edition,
  type Atlas,
  type SceneState,
  type Sex,
} from './anatomy';

const initial = (sex: Sex): SceneState => ({
  explode: 0,
  visible: defaultVisible(sex),
  selected: [],
  isolate: false,
  view: 'front',
  rotate: false,
  reset: 0,
});

export default function Home() {
  const [sex, setSex] = useState<Sex>('male');
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [state, setState] = useState<SceneState>(() => initial('male'));
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const abort = new AbortController();

    setAtlas(null);
    setProgress(0);
    setError('');
    setState(initial(sex));

    fetch(edition(sex).manifest, { signal: abort.signal })
      .then(response => {
        if (!response.ok) throw new Error('Unable to load anatomy');
        return response.json();
      })
      .then(data => setAtlas(data as Atlas))
      .catch(err => {
        if (err.name !== 'AbortError') setError(err.message);
      });

    return () => abort.abort();
  }, [sex]);

  const parts = useMemo(
    () => new Map(atlas?.parts.map(p => [p.id, p])),
    [atlas]
  );

  const choosePart = (id: string) => {
    const part = parts.get(id);
    if (!part) return;

    setState(current => ({
      ...current,
      selected: [id],
      isolate: false,
      rotate: false,
    }));

    window.parent.postMessage(
      {
        type: 'HUMAN_ATLAS_SELECTION',
        id: part.id,
        name: part.name,
        sex,
      },
      '*'
    );
  };

  return (
    <main
      className="studio"
      style={{
        width: '100%',
        height: '100dvh',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {atlas && (
        <AnatomyScene
          atlas={atlas}
          state={{ ...state, inspectorOpen: false }}
          onSelect={choosePart}
          onProgress={setProgress}
          onError={setError}
        />
      )}

      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 20,
        }}
      >
        <select
          value={sex}
          onChange={event => setSex(event.target.value as Sex)}
          aria-label="Choose body"
          style={{
            padding: '10px',
            borderRadius: 8,
            background: 'white',
            color: '#222',
          }}
        >
          <option value="male">Male - رجل</option>
          <option value="female">Female - امرأة</option>
        </select>
      </div>

      {progress < 100 && !error && (
        <div
          role="status"
          style={{
            position: 'absolute',
            bottom: 20,
            left: 20,
            zIndex: 20,
            background: 'white',
            padding: 12,
            borderRadius: 8,
            color: '#222',
          }}
        >
          Loading anatomy: {progress}%
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            bottom: 20,
            left: 20,
            zIndex: 20,
            background: 'white',
            padding: 12,
            color: '#b91c1c',
          }}
        >
          {error}
        </div>
      )}
    </main>
  );
}
