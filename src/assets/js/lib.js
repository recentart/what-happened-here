// Shared, dependency-free logic used by the browser and by the build/tests.
// Years use historical numbering: 44 BCE is -44 and there is no year 0.

export const CATEGORIES = [
  { id: 'event', label: 'Historical events', short: 'Historical event', color: '#2f5f8f' },
  { id: 'landmark', label: 'Buildings & landmarks', short: 'Landmark', color: '#8a6512' },
  { id: 'person', label: 'Important people', short: 'Person', color: '#7b3f7d' },
  { id: 'disaster', label: 'Disasters', short: 'Disaster', color: '#b2362a' },
  { id: 'battle', label: 'Battles & conflicts', short: 'Battle / conflict', color: '#56632a' },
  { id: 'invention', label: 'Inventions & discoveries', short: 'Invention / discovery', color: '#15746a' },
  { id: 'culture', label: 'Cultural events', short: 'Cultural event', color: '#b9531a' },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const startYear = (when) => when.start[0];
export const endYear = (when) => (when.end ? when.end[0] : when.start[0]);

/** Sortable number for a partial date [y, m?, d?]. */
export function dateKey(parts) {
  const [y, m = 0, d = 0] = parts;
  return y * 10000 + m * 100 + d;
}

export function formatYear(y) {
  if (y < 0) return `${-y} BCE`;
  if (y < 1000) return `${y} CE`;
  return String(y);
}

/** Does an entry's date range overlap the [from, to] year window (inclusive)? */
export function overlaps(when, from, to) {
  return startYear(when) <= to && endYear(when) >= from;
}

/**
 * Parse a year typed by a person: "1789", "44 BC", "44 BCE", "-44", "AD 79",
 * "79 CE", "c. 1450". Returns an integer (BCE negative) or null.
 */
export function parseYear(input) {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase().replace(/[.,]/g, '').replace(/^(c|ca|circa)\s*/, '').trim();
  if (!s) return null;
  let sign = 1;
  if (/\b(bce|bc)$/.test(s)) { sign = -1; s = s.replace(/\b(bce|bc)$/, '').trim(); }
  else if (/\b(ce|ad)$/.test(s)) s = s.replace(/\b(ce|ad)$/, '').trim();
  else if (/^(ad|ce)\b/.test(s)) s = s.replace(/^(ad|ce)\b/, '').trim();
  if (!/^[-−]?\d{1,4}$/.test(s)) return null;
  const n = parseInt(s.replace('−', '-'), 10) * sign;
  if (n === 0) return null;
  return n;
}

// ---- Timeline scale ------------------------------------------------------
// History is unevenly spread, so the slider is piecewise-linear between stops:
// each span gets the same width on screen.
export const CURRENT_YEAR = new Date().getFullYear();
export const TIMELINE_STOPS = [-3000, -1000, 1, 1000, 1500, 1800, 1900, 1950, 2000, CURRENT_YEAR];
const STEP = [50, 25, 10, 5, 5, 1, 1, 1, 1];

export function yearToPos(y, stops = TIMELINE_STOPS) {
  if (y <= stops[0]) return 0;
  if (y >= stops[stops.length - 1]) return 1;
  const seg = 1 / (stops.length - 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]; const b = stops[i + 1];
    if (y >= a && y <= b) return seg * (i + (y - a) / (b - a));
  }
  return 1;
}

export function posToYear(p, stops = TIMELINE_STOPS) {
  if (p <= 0) return stops[0];
  if (p >= 1) return stops[stops.length - 1];
  const seg = 1 / (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p / seg));
  const a = stops[i]; const b = stops[i + 1];
  let y = a + ((p - i * seg) / seg) * (b - a);
  const step = STEP[i] || 1;
  y = Math.round(y / step) * step;
  if (y === 0) y = 1;
  return Math.max(stops[0], Math.min(stops[stops.length - 1], y));
}

// ---- Search ---------------------------------------------------------------
export function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

const FIELD_WEIGHTS = { title: 6, place: 5, people: 4, tags: 3, category: 2, summary: 1 };

export function buildIndex(entries, places = []) {
  const placeName = Object.fromEntries(places.map((p) => [p.slug, p.name]));
  const docs = entries.map((e) => ({
    type: 'entry', slug: e.slug, item: e,
    fields: {
      title: normalize(e.title),
      place: normalize([e.where.name, placeName[e.where.place] || '', e.where.country].join(' ')),
      people: normalize((e.people || []).join(' ')),
      tags: normalize((e.tags || []).join(' ')),
      category: normalize(CATEGORY[e.category].label + ' ' + CATEGORY[e.category].short),
      summary: normalize(e.summary),
    },
  }));
  const placeDocs = places.map((p) => ({
    type: 'place', slug: p.slug, item: p,
    fields: { title: normalize(p.name), place: normalize(p.name + ' ' + p.country), people: '', tags: '', category: '', summary: normalize(p.description) },
  }));
  return [...placeDocs, ...docs];
}

/** Returns [{doc, score}] where every query word matches some field. */
export function search(index, query) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const doc of index) {
    let score = 0;
    let ok = true;
    for (const w of words) {
      let best = 0;
      for (const [field, text] of Object.entries(doc.fields)) {
        if (!text) continue;
        const weight = FIELD_WEIGHTS[field];
        if ((' ' + text + ' ').includes(' ' + w + ' ')) best = Math.max(best, weight * 2);
        else if ((' ' + text).includes(' ' + w)) best = Math.max(best, weight * 1.5);
        else if (w.length >= 3 && text.includes(w)) best = Math.max(best, weight);
      }
      if (!best) { ok = false; break; }
      score += best;
    }
    if (ok) out.push({ doc, score: doc.type === 'place' ? score + 3 : score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Apply search text, category set and year window. Returns matching entries. */
export function filterEntries(entries, index, { q = '', cats = null, from = -Infinity, to = Infinity } = {}) {
  let list = entries;
  if (q && q.trim()) {
    const hits = new Set(search(index, q).filter((r) => r.doc.type === 'entry').map((r) => r.doc.slug));
    list = list.filter((e) => hits.has(e.slug));
  }
  if (cats && cats.size) list = list.filter((e) => cats.has(e.category));
  return list.filter((e) => overlaps(e.when, from, to));
}

export function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
