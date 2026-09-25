// Helpers shared by the home explorer and the small page maps.
import { CATEGORIES } from './lib.js';

const BASE = '/vendor/maplibre-gl-5.24.0';
let loading;

/** Loads MapLibre (CSP build) once, on demand. */
export function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${BASE}/maplibre-gl-csp.js`;
    s.onload = () => {
      window.maplibregl.setWorkerUrl(`${BASE}/maplibre-gl-csp-worker.js`);
      resolve(window.maplibregl);
    };
    s.onerror = () => reject(new Error('The map library could not be loaded.'));
    document.head.append(s);
  });
  return loading;
}

export function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
// OpenFreeMap: free vector tiles, no API key. Attribution comes from the style.
export const styleUrl = () => `https://tiles.openfreemap.org/styles/${dark() ? 'dark' : 'positron'}`;
/**
 * Fetch the basemap style, falling back to a plain background if the tile service is
 * unreachable, so markers and cards keep working. Returns { style, fallback }.
 */
export async function pickStyle(timeoutMs = 8000) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(styleUrl(), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`style ${res.status}`);
    return { style: await res.json(), fallback: false };
  } catch {
    return {
      fallback: true,
      style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': dark() ? '#241f19' : '#e6ddca' } }] },
    };
  }
}
export const FALLBACK_NOTE = 'The background map could not be loaded, so places are shown without streets or borders.';

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const categoryColor = ['match', ['get', 'category'], ...CATEGORIES.flatMap((c) => [c.id, c.color]), '#555555'];
export const strokeColor = () => (dark() ? '#16130f' : '#ffffff');
