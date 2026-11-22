'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Maximize2, X } from 'lucide-react';
import AnatomyScene from './scene';
import { edition, type Atlas, type SceneState, type Sex, type SystemId } from './anatomy';
import { parseSurface, surfaceName } from './body-surface';

// Male or female (owner request 2026-11-22). The female model is a different reference body (HuBMAP female v1.10): it
// has the skin, organs and female organs, its own spine, pelvis and knees, bones borrowed from the male model, and
// the leg muscles of a second woman; it has no muscles of the trunk or arms. A tap on its skin anywhere selects that
// area of the body.
const SEX_KEY = 'human-atlas-sex';
const savedSex = (): Sex => {
  try {
    return localStorage.getItem(SEX_KEY) === 'female' ? 'female' : 'male';
  } catch {
    return 'male';
  }
};

// Two simple views for patients (owner request 2026-11-17): «العضلات» (muscles with the skeleton, tendons, eyes and
// ears; for the female model also its skin, borrowed bones and leg muscles) and «الأعضاء الداخلية» (the organs).
type Layer = 'muscles' | 'organs';
const LAYERS: Record<Sex, Record<Layer, SystemId[]>> = {
  male: {
    muscles: ['muscular', 'skeletal', 'connective', 'sensory'],
    organs: ['cardiac', 'respiratory', 'digestive', 'urinary', 'endocrine', 'nervous', 'brain', 'lymphatic'],
  },
  female: {
    muscles: ['muscular', 'donor-muscle', 'skeletal', 'borrowed', 'connective', 'sensory', 'integumentary'],
    organs: ['cardiac', 'respiratory', 'digestive', 'urinary', 'endocrine', 'nervous', 'brain', 'lymphatic'],
  },
};

const initial = (sex: Sex): SceneState => ({
  explode: 0,
  visible: LAYERS[sex].muscles,
  selected: [],
  highlighted: [],
  highlightedAreas: [],
  isolate: false,
  view: 'front',
  rotate: false,
  reset: 0,
});

// A message from the page around the model (Bubble) that clears the selection and the doctor's highlight, for example
// when the patient starts a new chat with «+». The main form is { type: 'HUMAN_ATLAS_CLEAR' }; simpler forms work too.
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

// The doctor's highlight (2026-11-20; areas added 2026-11-22): when the doctor asks the patient to press or check a
// place, the page around the model sends { type: 'HUMAN_ATLAS_HIGHLIGHT', parts: [...], regions: [{area, side}] }
// (bodyHighlight from the doctor's reply). The areas work on both models; the part names are the male model's.
// The place turns violet, a different colour from the patient's own selection. Empty lists remove it.
type Highlight = { parts: string[]; regions: { area: string; side: string }[] };
const highlightOf = (data: unknown): Highlight | null => {
  if (!data || typeof data !== 'object') return null;
  const message = data as { type?: unknown; parts?: unknown; regions?: unknown };
  if (message.type !== 'HUMAN_ATLAS_HIGHLIGHT') return null;
  const parts = Array.isArray(message.parts) ? message.parts.filter((part): part is string => typeof part === 'string') : [];
  const regions = Array.isArray(message.regions)
    ? message.regions.filter((r): r is { area: string; side: string } => !!r && typeof r === 'object' && typeof (r as { area?: unknown }).area === 'string')
      .map(r => ({ area: r.area, side: typeof r.side === 'string' ? r.side : 'both' }))
    : [];
  return { parts, regions };
};

// The doctor's areas that are areas of the skin (the rest are organs, or small places shown by their parts).
const SKIN_AREA: Record<string, string> = Object.fromEntries([
  ...['head', 'neck', 'shoulder', 'upper_arm', 'forearm', 'hand', 'fingers', 'chest', 'upper_back', 'abdomen', 'lower_back',
    'pelvis', 'hip', 'buttock', 'thigh', 'knee', 'knee_back', 'shin', 'calf', 'ankle', 'heel', 'foot_top'].map(area => [area, area]),
  ['thigh_front', 'thigh'], ['thigh_back', 'thigh'], ['thigh_inner', 'thigh'], ['thigh_outer', 'thigh'], ['lower_leg', 'shin'],
  ['groin', 'pelvis'], ['elbow', 'forearm'], ['wrist', 'hand'], ['thumb', 'hand'], ['face', 'head'], ['jaw', 'head'],
]);

// Blood vessels are left out of a highlight: the patient checks the muscle, bone or organ.
const VESSEL = /\b(?:artery|arteries|arterial|vein|veins|venous|aorta|vena|trunk|arch|plexus|sinus)\b/i;
const sideOfName = (name: string) => (/\bright\b/i.test(name) ? 'right' : /\bleft\b/i.test(name) ? 'left' : null);

// Several parts can be selected (2026-11-20): their names go to the chat together in `name`, joined with " | ", so
// Bubble keeps sending one text field; `names` and `ids` list them too.
const SEPARATOR = ' | ';

export default function Home() {
  const [sex, setSex] = useState<Sex>('male');
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [state, setState] = useState<SceneState>(() => initial('male'));
  const [layer, setLayer] = useState<Layer>('muscles');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [regions, setRegions] = useState<Record<Sex, Record<string, string>> | null>(null);

  // The patient's last choice of model is remembered on this device.
  useEffect(() => {
    const remembered = savedSex();
    if (remembered !== 'male') {
      setSex(remembered);
      setState(initial(remembered));
    }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    setAtlas(null);
    setProgress(0);
    setError('');
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

  // Each part's simple area (generated by the doctor's server project from the same rules), for the highlight by area.
  useEffect(() => {
    fetch('/models/regions.json')
      .then(response => (response.ok ? response.json() : null))
      .then(data => setRegions(data as Record<Sex, Record<string, string>> | null))
      .catch(() => setRegions(null));
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
  // all of them in name (joined), names and ids. After «إلغاء الكل» the name is empty. A tap on the female model's
  // skin is sent as «Body surface: chest (left)».
  const nameOf = (id: string) => {
    const surface = parseSurface(id);
    return surface ? surfaceName(surface.area, surface.side) : parts.get(id)?.name ?? '';
  };
  const sendSelection = (ids: string[], tapped?: string) => {
    const chosen = ids.filter(id => nameOf(id));
    window.parent.postMessage(
      {
        type: 'HUMAN_ATLAS_SELECTION',
        id: tapped ?? chosen.at(-1) ?? '',
        name: chosen.map(nameOf).join(SEPARATOR),
        names: chosen.map(nameOf),
        ids: chosen,
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
        setState(current => ({ ...current, selected: [], highlighted: [], highlightedAreas: [], isolate: false }));
        return;
      }
      const highlight = highlightOf(event.data);
      if (!highlight || !atlas) return;
      const map = regions?.[sex];
      let ids: string[];
      if (highlight.regions.length && map) {
        // By area, on either model: the parts of that area and side.
        ids = atlas.parts.filter(p => {
          const area = map[p.id];
          if (!area || VESSEL.test(p.name) || p.system === 'integumentary') return false;
          const centreX = (p.bounds[0][0] + p.bounds[1][0]) / 2;
          const side = sideOfName(p.name) ?? (centreX > 0.03 ? 'left' : centreX < -0.03 ? 'right' : null);
          return highlight.regions.some(r => r.area === area && (r.side === 'both' || !side || r.side === side));
        }).map(p => p.id);
      } else {
        ids = highlight.parts.map(name => idsByName.get(name.toLowerCase())).filter((id): id is string => Boolean(id));
      }
      // The female model's skin also shows the area (its trunk and arms have no muscles to colour). Only areas of the
      // body surface: an organ (the liver) is shown in the organs view, and a toe by its bone.
      const areas = sex === 'female'
        ? highlight.regions.map(r => ({ ...r, area: SKIN_AREA[r.area] ?? '' })).filter(r => r.area && (r.area !== 'thigh' || !ids.length))
        : [];
      if (!ids.length && !areas.length) {
        setState(current => ({ ...current, highlighted: [], highlightedAreas: [] }));
        return;
      }
      // The view that holds the place: the muscles view when it has a muscle, bone or tendon the patient can press,
      // or a skin area; the organs view for an organ only (the liver).
      const systems = ids.map(id => parts.get(id)?.system);
      const organs = !areas.length && !systems.some(system => LAYERS[sex].muscles.includes(system as SystemId));
      const nextLayer: Layer = organs ? 'organs' : 'muscles';
      // In the muscles view only what that view shows is coloured (not the folds of the gut behind the belly wall).
      if (!organs) ids = ids.filter(id => LAYERS[sex].muscles.includes(parts.get(id)?.system as SystemId));
      if (nextLayer !== layer) setLayer(nextLayer);
      // Front or back of the body.
      const zOf = (id: string) => { const b = parts.get(id)!.bounds; return (b[0][2] + b[1][2]) / 2; };
      const layerIds = atlas.parts.filter(p => LAYERS[sex][nextLayer].includes(p.system as SystemId)).map(p => p.id);
      const middle = layerIds.reduce((sum, id) => sum + zOf(id), 0) / Math.max(1, layerIds.length);
      const BACK = new Set(['upper_back', 'lower_back', 'buttock', 'calf', 'knee_back', 'thigh_back', 'heel']);
      const back = ids.length
        ? ids.reduce((sum, id) => sum + zOf(id), 0) / ids.length < middle - .03
        : areas.every(r => BACK.has(r.area));
      setState(current => ({ ...current, highlighted: ids, highlightedAreas: areas, visible: LAYERS[sex][nextLayer], view: back ? 'back' : 'front', reset: current.reset + 1 }));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [atlas, parts, idsByName, layer, regions, sex]);

  // A tap colours a part and keeps the others (2026-11-20); a tap on a coloured part un-colours only that one. The
  // same for an area of the female model's skin.
  const choosePart = (id: string) => {
    if (!nameOf(id)) return;
    const next = state.selected.includes(id) ? state.selected.filter(other => other !== id) : [...state.selected, id];
    setState(current => ({ ...current, selected: next, isolate: false, rotate: false }));
    sendSelection(next, id);
  };
  const clearAll = () => {
    setState(current => ({ ...current, selected: [], highlighted: [], highlightedAreas: [], isolate: false }));
    sendSelection([]);
  };

  const chooseLayer = (next: Layer) => {
    if (next === layer) return;
    setLayer(next);
    // The organs' extra parts load only now. Changed 2026-11-20: the selected parts stay selected (and stay visible) in
    // the other view, so the patient can choose toes and then an organ.
    setState(current => ({ ...current, visible: LAYERS[sex][next], reset: current.reset + 1 }));
  };
  // Male or female: the other model loads; the selection and highlight start empty (their parts are different).
  const chooseSex = (next: Sex) => {
    if (next === sex) return;
    try { localStorage.setItem(SEX_KEY, next); } catch { /* private mode: not remembered */ }
    setSex(next);
    setLayer('muscles');
    setState(initial(next));
    if (state.selected.length) sendSelection([]);
  };
  const flip = () => setState(current => ({ ...current, view: current.view === 'back' ? 'front' : 'back' }));
  const resetView = () => setState(current => ({ ...current, view: 'front', reset: current.reset + 1 }));

  return (
    <main className="studio patient-atlas" dir="rtl">
      {atlas && (
        <AnatomyScene
          key={sex}
          atlas={atlas}
          sex={sex}
          state={{ ...state, inspectorOpen: false }}
          onSelect={choosePart}
          onProgress={setProgress}
          onError={setError}
        />
      )}

      <div className="atlas-bar">
        <div className="atlas-stack">
          <div className="atlas-layers" role="group" aria-label="العرض">
            <button type="button" aria-pressed={layer === 'muscles'} onClick={() => chooseLayer('muscles')}>العضلات</button>
            <button type="button" aria-pressed={layer === 'organs'} onClick={() => chooseLayer('organs')}>الأعضاء الداخلية</button>
          </div>
          <div className="atlas-layers atlas-sex" role="group" aria-label="ذكر أو أنثى">
            <button type="button" aria-pressed={sex === 'male'} onClick={() => chooseSex('male')}>ذكر</button>
            <button type="button" aria-pressed={sex === 'female'} onClick={() => chooseSex('female')}>أنثى</button>
          </div>
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
          {(state.selected.length > 0 || (state.highlighted?.length ?? 0) > 0 || (state.highlightedAreas?.length ?? 0) > 0) && (
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
