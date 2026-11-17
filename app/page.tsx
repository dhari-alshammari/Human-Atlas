'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Maximize2 } from 'lucide-react';
import AnatomyScene from './scene';
import { edition, type Atlas, type SceneState, type Sex, type SystemId } from './anatomy';

// The male model only (the male/female choice was removed at the owner's request).
const sex: Sex = 'male';

// Two simple views for patients (owner request 2026-11-17), instead of the male/female choice:
// «العضلات» (muscles with the skeleton, tendons, eyes and ears) and «الأعضاء الداخلية» (the organs).
type Layer = 'muscles' | 'organs';
const LAYERS: Record<Layer, SystemId[]> = {
  muscles: ['muscular', 'skeletal', 'connective', 'sensory'],
  organs: ['cardiac', 'respiratory', 'digestive', 'urinary', 'endocrine', 'nervous', 'brain', 'lymphatic'],
};

const initial = (): SceneState => ({
  explode: 0,
  visible: LAYERS.muscles,
  selected: [],
  isolate: false,
  view: 'front',
  rotate: false,
  reset: 0,
});

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
  const [state, setState] = useState<SceneState>(initial);
  const [layer, setLayer] = useState<Layer>('muscles');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const abort = new AbortController();
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

  // The tapped part's name goes to the page around the model exactly as before, in both views.
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

  const chooseLayer = (next: Layer) => {
    if (next === layer) return;
    setLayer(next);
    // The organs' extra parts load only now; the highlight of a part from the other view is cleared on the model.
    setState(current => ({ ...current, visible: LAYERS[next], selected: [], reset: current.reset + 1 }));
  };
  const flip = () => setState(current => ({ ...current, view: current.view === 'back' ? 'front' : 'back' }));
  const resetView = () => setState(current => ({ ...current, view: 'front', reset: current.reset + 1 }));

  return (
    <main className="studio patient-atlas" dir="rtl">
      {atlas && (
        <AnatomyScene
          atlas={atlas}
          state={{ ...state, inspectorOpen: false }}
          onSelect={choosePart}
          onProgress={setProgress}
          onError={setError}
        />
      )}

      <div className="atlas-bar">
        <div className="atlas-layers" role="group" aria-label="العرض">
          <button type="button" aria-pressed={layer === 'muscles'} onClick={() => chooseLayer('muscles')}>العضلات</button>
          <button type="button" aria-pressed={layer === 'organs'} onClick={() => chooseLayer('organs')}>الأعضاء الداخلية</button>
        </div>
        <div className="atlas-tools">
          <button type="button" onClick={flip} aria-label="لف الجسم أمام أو خلف">
            <RefreshCw size={18} aria-hidden="true" />
            <span>لف</span>
          </button>
          <button type="button" onClick={resetView} aria-label="رجوع للجسم كامل">
            <Maximize2 size={18} aria-hidden="true" />
            <span>رجوع</span>
          </button>
        </div>
      </div>

      {(!atlas || progress < 100) && !error && (
        <div className="atlas-loading" role="status">
          <i aria-hidden="true" />
          <span>جاري التحميل…</span>
        </div>
      )}

      {error && (
        <div className="atlas-loading atlas-error" role="alert">
          {error}
        </div>
      )}
    </main>
  );
}
