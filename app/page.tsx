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

// The male model only (the male/female choice was removed at the owner's request).
const sex: Sex = 'male';

// A message from the page around the model (Bubble) that clears the highlighted part, for example when the
// patient starts a new chat with «+». The main form is { type: 'HUMAN_ATLAS_CLEAR' }; a few simpler forms work too.
const isClearMessage = (data: unknown): boolean => {
  if (data === 'clear' || data === 'HUMAN_ATLAS_CLEAR') return true;
  if (!data || typeof data !== 'object') return false;
  const message = data as { type?: unknown; action?: unknown };
  return (
    message.type === 'HUMAN_ATLAS_CLEAR' ||
    message.type === 'CLEAR_SELECTION' ||
    message.action === 'clear'
  );
};

export default function Home() {
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
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isClearMessage(event.data)) return;
      setState(current => ({ ...current, selected: [], isolate: false }));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

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
