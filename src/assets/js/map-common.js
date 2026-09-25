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
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const categoryColor = ['match', ['get', 'category'], ...CATEGORIES.flatMap((c) => [c.id, c.color]), '#555555'];
export const strokeColor = () => (dark() ? '#16130f' : '#ffffff');
