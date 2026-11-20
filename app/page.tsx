'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Maximize2, X } from 'lucide-react';
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
  highlighted: [],
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

// The doctor's highlight (2026-11-20): when the doctor asks the patient to press or check a place, the page around the
// model sends { type: 'HUMAN_ATLAS_HIGHLIGHT', parts: [...part names] } (the bodyHighlight.parts of the doctor's
// reply). Those parts turn violet, a different colour from the patient's own selection. An empty list removes it.
const highlightParts = (data: unknown): string[] | null => {
  if (!data || typeof data !== 'object') return null;
  const message = data as { type?: unknown; parts?: unknown };
  if (message.type !== 'HUMAN_ATLAS_HIGHLIGHT') return null;
  return Array.isArray(message.parts) ? message.parts.filter((part): part is string => typeof part === 'string') : [];
};

// Several parts can be selected (2026-11-20): their names go to the chat together in `name`, joined with " | ", so
// Bubble keeps sending one text field; `names` and `ids` list them too.
const SEPARATOR = ' | ';

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

  const parts = useMemo(
    () => new Map(atlas?.parts.map(p => [p.id, p])),
    [atlas]
  );
  const idsByName = useMemo(
    () => new Map(atlas?.parts.map(p => [p.name.toLowerCase(), p.id])),
    [atlas]
  );

  // The selected parts go to the page around the model (Bubble) after every change: the last tapped part in id, and
  // all of them in name (joined), names and ids. After «إلغاء الكل» the name is empty.
  const sendSelection = (ids: string[], tapped?: string) => {
    const chosen = ids.map(id => parts.get(id)).filter((part): part is NonNullable<typeof part> => Boolean(part));
    window.parent.postMessage(
      {
        type: 'HUMAN_ATLAS_SELECTION',
        id: tapped ?? chosen.at(-1)?.id ?? '',
        name: chosen.map(part => part.name).join(SEPARATOR),
        names: chosen.map(part => part.name),
        ids: chosen.map(part => part.id),
        count: chosen.length,
        sex,
      },
      '*'
    );
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (isClearMessage(event.data)) {
        // A new chat («+»): every selection and the doctor's highlight go.
        setState(current => ({ ...current, selected: [], highlighted: [], isolate: false }));
        return;
      }
      const names = highlightParts(event.data);
      if (!names) return;
      const ids = names.map(name => idsByName.get(name.toLowerCase())).filter((id): id is string => Boolean(id));
      if (ids.length && atlas) {
        // The view that holds the place (an organ is in «الأعضاء الداخلية»), and its side of the body (front or back).
        const systems = ids.map(id => parts.get(id)?.system);
        // The muscles view when the place has a muscle, bone or tendon the patient can press; the organs view for an
        // organ only (the liver).
        const organs = !systems.some(system => LAYERS.muscles.includes(system as SystemId));
        const nextLayer: Layer = organs ? 'organs' : 'muscles';
        if (nextLayer !== layer) setLayer(nextLayer);
        const zOf = (id: string) => { const b = parts.get(id)!.bounds; return (b[0][2] + b[1][2]) / 2; };
        const all = atlas.parts.filter(p => LAYERS[nextLayer].includes(p.system as SystemId)).map(p => p.id);
        const middle = all.reduce((sum, id) => sum + zOf(id), 0) / Math.max(1, all.length);
        const back = ids.reduce((sum, id) => sum + zOf(id), 0) / ids.length < middle - .03;
        setState(current => ({ ...current, highlighted: ids, visible: LAYERS[nextLayer], view: back ? 'back' : 'front', reset: current.reset + 1 }));
      } else {
        setState(current => ({ ...current, highlighted: [] }));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [atlas, parts, idsByName, layer]);

  // A tap colours a part and keeps the others (2026-11-20); a tap on a coloured part un-colours only that one.
  const choosePart = (id: string) => {
    if (!parts.get(id)) return;
    const next = state.selected.includes(id) ? state.selected.filter(other => other !== id) : [...state.selected, id];
    setState(current => ({ ...current, selected: next, isolate: false, rotate: false }));
    sendSelection(next, id);
  };
  const clearAll = () => {
    setState(current => ({ ...current, selected: [], highlighted: [], isolate: false }));
    sendSelection([]);
  };

  const chooseLayer = (next: Layer) => {
    if (next === layer) return;
    setLayer(next);
    // The organs' extra parts load only now. Changed 2026-11-20: the selected parts stay selected (and stay visible) in
    // the other view, so the patient can choose toes and then an organ.
    setState(current => ({ ...current, visible: LAYERS[next], reset: current.reset + 1 }));
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
        <div className="atlas-layers atlas-tools" role="group" aria-label="التحكم">
          <button type="button" onClick={flip} aria-label="لف الجسم أمام أو خلف">
            <RefreshCw size={16} aria-hidden="true" />
            <span>لف</span>
          </button>
          <button type="button" onClick={resetView} aria-label="رجوع للجسم كامل">
            <Maximize2 size={16} aria-hidden="true" />
            <span>رجوع</span>
          </button>
          {(state.selected.length > 0 || (state.highlighted?.length ?? 0) > 0) && (
            <button type="button" onClick={clearAll} aria-label="إلغاء كل الأجزاء المختارة">
              <X size={16} aria-hidden="true" />
              <span>إلغاء الكل</span>
            </button>
          )}
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
