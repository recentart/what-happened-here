// Home page explorer: map, search, category filters and timeline.
// Everything runs in the browser against /data/entries.json.
import {
  CATEGORY, TIMELINE_STOPS, CURRENT_YEAR, buildIndex, search, filterEntries, formatYear, parseYear,
  yearToPos, posToYear, startYear, endYear, distanceKm, escapeHtml as esc,
} from './lib.js';
import { loadMapLibre, webglSupported, styleUrl, reduceMotion, categoryColor, strokeColor } from './map-common.js';

const $ = (id) => document.getElementById(id);
const MIN = TIMELINE_STOPS[0];
const MAX = CURRENT_YEAR;

const els = {
  form: $('search-form'), q: $('q'), results: $('results'), count: $('count'), empty: $('empty'), placeHits: $('place-hits'),
  fromPos: $('from-pos'), toPos: $('to-pos'), fromYear: $('from-year'), toYear: $('to-year'), fill: $('range-fill'),
  dots: $('range-dots'), ticks: $('range-ticks'), reset: $('reset'), near: $('near-me'), status: $('map-status'),
  card: $('card'), cardBody: $('card-body'), cardClose: $('card-close'),
};
const chips = [...document.querySelectorAll('.chip')];
const items = new Map([...els.results.children].map((li) => [li.dataset.slug, li]));

const state = { q: '', cats: new Set(), from: MIN, to: MAX, here: null, selected: null };
let data; let index; let map; let bySlug; let lastQ = null; let userMarker;

// ---- URL state (shareable views) ---------------------------------------------
function readUrl() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') || '';
  state.cats = new Set((p.get('cat') || '').split(',').filter((c) => CATEGORY[c]));
  state.from = parseYear(p.get('from')) ?? MIN;
  state.to = parseYear(p.get('to')) ?? MAX;
  if (state.from > state.to) [state.from, state.to] = [state.to, state.from];
  return p.get('focus');
}
function writeUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.cats.size) p.set('cat', [...state.cats].join(','));
  if (state.from !== MIN) p.set('from', state.from);
  if (state.to !== MAX) p.set('to', state.to);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}${location.hash}` : location.pathname + location.hash);
}

// ---- Timeline control ---------------------------------------------------------
function buildTimeline() {
  const labels = { [-3000]: '3000 BCE', 1: '1 CE', 1000: '1000', 1500: '1500', 1800: '1800', 1900: '1900', 1950: '1950' };
  els.ticks.innerHTML = Object.entries(labels).map(([y, l]) => {
    const minor = ['1000', '1950'].includes(y) ? ' minor' : '';
    return `<span class="tick${minor}" style="left:${(yearToPos(+y) * 100).toFixed(2)}%">${l}</span>`;
  }).join('') + `<span class="tick end" style="left:100%">Today</span>`;
  els.dots.innerHTML = data.entries.map((e) => {
    const a = yearToPos(startYear(e.when)); const b = yearToPos(endYear(e.when));
    return `<span class="tdot" style="left:${(a * 100).toFixed(2)}%;width:max(4px,${((b - a) * 100).toFixed(2)}%);--c:${CATEGORY[e.category].color}"></span>`;
  }).join('');
}
function syncTimeline() {
  const a = yearToPos(state.from); const b = yearToPos(state.to);
  els.fromPos.value = Math.round(a * 1000);
  els.toPos.value = Math.round(b * 1000);
  els.fill.style.left = `${a * 100}%`;
  els.fill.style.width = `${(b - a) * 100}%`;
  els.fromPos.setAttribute('aria-valuetext', formatYear(state.from));
  els.toPos.setAttribute('aria-valuetext', state.to === MAX ? 'Today' : formatYear(state.to));
  if (document.activeElement !== els.fromYear) els.fromYear.value = formatYear(state.from);
  if (document.activeElement !== els.toYear) els.toYear.value = formatYear(state.to);
}

// ---- Filtering ------------------------------------------------------------------
function apply({ fit = false } = {}) {
  const list = filterEntries(data.entries, index, state);
  const visible = new Set(list.map((e) => e.slug));

  // Results list: hide filtered-out rows; sort by distance when "near me" is on.
  let order = data.entries;
  if (state.here) order = [...data.entries].sort((x, y) => distanceKm(state.here, x.where) - distanceKm(state.here, y.where));
  for (const e of order) {
    const li = items.get(e.slug);
    li.hidden = !visible.has(e.slug);
    const meta = li.querySelector('.result-meta');
    meta.dataset.base ||= meta.textContent;
    meta.textContent = state.here ? `${meta.dataset.base} · ${Math.round(distanceKm(state.here, e.where)).toLocaleString()} km away` : meta.dataset.base;
    els.results.append(li);
  }

  const n = list.length;
  els.count.textContent = n === data.entries.length ? `${n} entries` : `${n} of ${data.entries.length} entries`;

  // Place guides that match the search text.
  const placeHits = state.q ? search(index, state.q).filter((r) => r.doc.type === 'place').map((r) => r.doc.item) : [];
  els.placeHits.innerHTML = placeHits.map((p) => `<a class="place-hit" href="/place/${p.slug}"><strong>${esc(p.name)}</strong> place guide · ${p.count} entries →</a>`).join('');

  // Empty state that explains why, instead of a blank list.
  if (!n) {
    const all = state.q ? filterEntries(data.entries, index, { q: state.q }) : [];
    let msg;
    if (state.q && !all.length && !placeHits.length) msg = `No entries match “${esc(state.q)}”. Try a city such as Paris, a person such as Marie Curie, or a broader word like “earthquake”. The collection is still small, so many places are not covered yet.`;
    else if (all.length) msg = `${all.length} ${all.length === 1 ? 'entry matches' : 'entries match'} “${esc(state.q)}” but ${all.length === 1 ? 'is' : 'are'} hidden by your category or timeline filters. <button type="button" class="linklike" id="clear-filters">Show ${all.length === 1 ? 'it' : 'them'}</button>`;
    else if (placeHits.length) msg = 'No individual entries match, but the place guide above does.';
    else msg = 'No entries fall within these filters. <button type="button" class="linklike" id="clear-filters">Reset the filters</button>';
    els.empty.innerHTML = msg;
    els.empty.hidden = false;
    $('clear-filters')?.addEventListener('click', () => { state.cats.clear(); state.from = MIN; state.to = MAX; syncControls(); apply({ fit: true }); });
  } else els.empty.hidden = true;

  if (map && map.getSource('entries')) {
    map.getSource('entries').setData(toGeoJSON(list));
    if (state.selected && !visible.has(state.selected)) closeCard();
    if (fit && n) fitTo(list);
  }
  writeUrl();
}

function syncControls() {
  els.q.value = state.q;
  for (const c of chips) c.setAttribute('aria-pressed', String(state.cats.has(c.dataset.cat)));
  syncTimeline();
}

// ---- Map ------------------------------------------------------------------------------
const toGeoJSON = (list) => ({
  type: 'FeatureCollection',
  features: list.map((e) => ({ type: 'Feature', properties: { slug: e.slug, category: e.category, title: e.title }, geometry: { type: 'Point', coordinates: [e.where.lon, e.where.lat] } })),
});

function fitTo(list, extra = []) {
  const pts = [...list.map((e) => [e.where.lon, e.where.lat]), ...extra];
  if (!pts.length) return;
  const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
  map.fitBounds(b, { padding: { top: 60, bottom: 60, left: 60, right: 60 }, maxZoom: 11, duration: reduceMotion() ? 0 : 800 });
}

async function initMap(focus) {
  if (!webglSupported()) throw new Error('Your browser cannot display the interactive map (WebGL is unavailable).');
  const lib = await loadMapLibre();
  map = new lib.Map({
    container: 'map', style: styleUrl(), center: [15, 30], zoom: 1.3, minZoom: 1,
    attributionControl: { compact: true }, cooperativeGestures: false, dragRotate: false, pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  window.whhMap = map; // exposed for debugging and the browser test suite
  map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
  map.on('error', (ev) => { if (!map.loaded()) showStatus('Some map tiles could not be loaded. The list of entries still works.'); console.warn(ev.error); });
  await new Promise((resolve) => map.on('load', resolve));

  map.addSource('entries', { type: 'geojson', data: toGeoJSON(filterEntries(data.entries, index, state)), cluster: true, clusterRadius: 38, clusterMaxZoom: 11 });
  map.addLayer({ id: 'clusters', type: 'circle', source: 'entries', filter: ['has', 'point_count'],
    paint: { 'circle-color': '#7a2e22', 'circle-opacity': 0.92, 'circle-radius': ['step', ['get', 'point_count'], 15, 5, 19, 10, 24], 'circle-stroke-width': 2, 'circle-stroke-color': strokeColor() } });
  map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'entries', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' } });
  map.addLayer({ id: 'points', type: 'circle', source: 'entries', filter: ['!', ['has', 'point_count']],
    paint: { 'circle-color': categoryColor, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 7, 10, 10], 'circle-stroke-width': 2.5, 'circle-stroke-color': strokeColor() } });
  map.addLayer({ id: 'selected', type: 'circle', source: 'entries', filter: ['==', ['get', 'slug'], ''],
    paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 16, 'circle-stroke-width': 3, 'circle-stroke-color': categoryColor } });

  map.on('click', 'clusters', async (ev) => {
    const f = ev.features[0];
    const zoom = await map.getSource('entries').getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({ center: f.geometry.coordinates, zoom, duration: reduceMotion() ? 0 : 500 });
  });
  map.on('click', 'points', (ev) => openCard(ev.features[0].properties.slug, { fly: false }));
  for (const layer of ['clusters', 'points']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }
  hideStatus();
  document.body.dataset.mapReady = '1';
  if (focus && bySlug[focus]) openCard(focus, { fly: true });
  else if (state.q || state.cats.size || state.from !== MIN || state.to !== MAX) fitTo(filterEntries(data.entries, index, state));
}

function showStatus(msg) { els.status.textContent = msg; els.status.hidden = false; els.status.classList.add('error'); }
function hideStatus() { els.status.hidden = true; }

// ---- Marker card -------------------------------------------------------------------------
let returnFocus = null;
function openCard(slug, { fly = true, fromKeyboard = false } = {}) {
  const e = bySlug[slug];
  if (!e) return;
  state.selected = slug;
  const cat = CATEGORY[e.category];
  const place = e.where.place ? data.places.find((p) => p.slug === e.where.place) : null;
  els.cardBody.innerHTML = `
    <p class="cat" style="--c:${cat.color}"><span class="dot" aria-hidden="true"></span>${esc(cat.short)}</p>
    <h2 id="card-title" tabindex="-1">${esc(e.title)}</h2>
    <p class="card-date">${esc(e.when.label)}${e.when.approx ? ' <span class="approx">approx.</span>' : ''}</p>
    <p class="card-place">${esc(e.where.name)}${place ? '' : `, ${esc(e.where.country)}`}</p>
    <p class="card-summary">${esc(e.summary)}</p>
    <a class="btn" href="/event/${e.slug}">Explore<span class="sr-only"> ${esc(e.title)}</span> →</a>`;
  els.card.setAttribute('aria-labelledby', 'card-title');
  els.card.hidden = false;
  if (map) {
    map.setFilter('selected', ['==', ['get', 'slug'], slug]);
    if (fly) map.flyTo({ center: [e.where.lon, e.where.lat], zoom: Math.max(map.getZoom(), 12), duration: reduceMotion() ? 0 : 1200 });
  }
  for (const [s, li] of items) li.classList.toggle('active', s === slug);
  if (fromKeyboard) { returnFocus = document.activeElement; $('card-title').focus(); }
}
function closeCard() {
  els.card.hidden = true;
  state.selected = null;
  if (map) map.setFilter('selected', ['==', ['get', 'slug'], '']);
  for (const li of items.values()) li.classList.remove('active');
  if (returnFocus) { returnFocus.focus(); returnFocus = null; }
}

// ---- Near me ---------------------------------------------------------------------------
function nearMe() {
  if (!('geolocation' in navigator)) { els.count.textContent = 'Your browser does not share location.'; return; }
  els.near.disabled = true;
  els.near.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition((pos) => {
    state.here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    els.near.disabled = false;
    els.near.textContent = 'Near me ✓';
    els.near.setAttribute('aria-pressed', 'true');
    apply();
    if (map) {
      userMarker?.remove();
      const el = document.createElement('div');
      el.className = 'you-are-here';
      el.title = 'Your approximate location';
      userMarker = new maplibregl.Marker({ element: el }).setLngLat([state.here.lon, state.here.lat]).addTo(map);
      const nearest = [...filterEntries(data.entries, index, state)].sort((a, b) => distanceKm(state.here, a.where) - distanceKm(state.here, b.where)).slice(0, 3);
      fitTo(nearest, [[state.here.lon, state.here.lat]]);
    }
  }, () => {
    els.near.disabled = false;
    els.near.textContent = 'Near me';
    els.count.textContent = 'Location unavailable — permission was denied or your position could not be found.';
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}

// ---- Wiring ------------------------------------------------------------------------------
function wire() {
  let qTimer;
  els.q.addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = els.q.value.trim(); apply({ fit: state.q !== lastQ && !!state.q }); lastQ = state.q; }, 120);
  });
  els.form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    state.q = els.q.value.trim();
    apply({ fit: true });
    document.getElementById('explore').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  });
  for (const c of chips) c.addEventListener('click', () => {
    const id = c.dataset.cat;
    state.cats.has(id) ? state.cats.delete(id) : state.cats.add(id);
    c.setAttribute('aria-pressed', String(state.cats.has(id)));
    apply({ fit: true });
  });
  let raf;
  const onSlide = (which) => {
    const a = posToYear(els.fromPos.value / 1000); const b = posToYear(els.toPos.value / 1000);
    if (which === 'from') state.from = Math.min(a, state.to); else state.to = Math.max(b, state.from);
    syncTimeline();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => apply());
  };
  els.fromPos.addEventListener('input', () => onSlide('from'));
  els.toPos.addEventListener('input', () => onSlide('to'));
  const onYear = (input, which) => {
    const y = parseYear(input.value);
    if (y == null || y < MIN || y > MAX) { input.setAttribute('aria-invalid', 'true'); return; }
    input.removeAttribute('aria-invalid');
    if (which === 'from') state.from = y; else state.to = y;
    if (state.from > state.to) [state.from, state.to] = [state.to, state.from];
    syncTimeline();
    apply();
  };
  els.fromYear.addEventListener('change', () => onYear(els.fromYear, 'from'));
  els.toYear.addEventListener('change', () => onYear(els.toYear, 'to'));
  for (const input of [els.fromYear, els.toYear]) input.addEventListener('blur', () => { input.removeAttribute('aria-invalid'); syncTimeline(); });
  for (const b of document.querySelectorAll('[data-era]')) b.addEventListener('click', () => {
    const [a, z] = b.dataset.era.split(',').map(Number);
    state.from = Math.max(MIN, a); state.to = Math.min(MAX, z);
    syncTimeline();
    apply({ fit: true });
  });
  els.reset.addEventListener('click', () => {
    Object.assign(state, { q: '', from: MIN, to: MAX, here: null });
    state.cats.clear();
    els.near.textContent = 'Near me';
    els.near.removeAttribute('aria-pressed');
    userMarker?.remove();
    syncControls();
    closeCard();
    apply();
    if (map) map.flyTo({ center: [15, 30], zoom: 1.3, duration: reduceMotion() ? 0 : 800 });
  });
  els.near.addEventListener('click', nearMe);
  els.results.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.locate');
    if (!btn) return;
    openCard(btn.dataset.slug, { fly: true, fromKeyboard: ev.detail === 0 });
    if (matchMedia('(max-width: 900px)').matches) $('map').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
  });
  els.cardClose.addEventListener('click', closeCard);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !els.card.hidden) closeCard(); });
}

// ---- Start ---------------------------------------------------------------------------------
(async () => {
  const focus = readUrl();
  try {
    data = await (await fetch('/data/entries.json')).json();
  } catch {
    els.count.textContent = 'The data could not be loaded. Each entry is still available from the list below.';
    showStatus('The map could not be loaded.');
    return;
  }
  bySlug = Object.fromEntries(data.entries.map((e) => [e.slug, e]));
  index = buildIndex(data.entries, data.places);
  buildTimeline();
  syncControls();
  wire();
  lastQ = state.q;
  apply();
  document.body.dataset.ready = '1';
  try { await initMap(focus); } catch (err) {
    showStatus(`${err.message} You can still browse every entry in the list.`);
    document.body.dataset.mapReady = 'failed';
  }
})();
