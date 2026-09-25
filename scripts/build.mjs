// Static site generator for What Happened Here?
// Reads data/ and src/, writes the complete website to site/.
//
//   node scripts/build.mjs
//
// No npm dependencies: plain Node 20+.

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { validate } from './validate.mjs';
import { CATEGORIES, CATEGORY, dateKey, startYear, endYear, formatYear, distanceKm, escapeHtml as esc } from '../src/assets/js/lib.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'site');
export const SITE = {
  name: 'What Happened Here?',
  url: (process.env.SITE_URL || 'https://what-happened-here.freewebtoolss.workers.dev').replace(/\/$/, ''),
  tagline: 'Explore the history of places around you — and around the world.',
  repo: 'https://github.com/recentart/what-happened-here',
};
const MAPLIBRE = 'maplibre-gl-5.24.0';

// ---- Load and check data ---------------------------------------------------
const { entries, places, images, errors, warnings } = validate(ROOT);
for (const w of warnings) console.warn('warning:', w);
if (errors.length) { console.error(errors.map((e) => 'error: ' + e).join('\n')); process.exit(1); }
entries.sort((a, b) => dateKey(a.when.start) - dateKey(b.when.start));
const bySlug = Object.fromEntries(entries.map((e) => [e.slug, e]));
const placeBySlug = Object.fromEntries(places.map((p) => [p.slug, p]));
for (const p of places) {
  p.entries = entries.filter((e) => e.where.place === p.slug);
}
const buildDate = new Date().toISOString().slice(0, 10);

// ---- Output helpers --------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
function write(path, content) {
  const full = join(OUT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
function copyDir(src, dest) {
  for (const f of readdirSync(src)) {
    const s = join(src, f); const d = join(dest, f);
    if (statSync(s).isDirectory()) { mkdirSync(d, { recursive: true }); copyDir(s, d); }
    else { mkdirSync(dirname(d), { recursive: true }); copyFileSync(s, d); }
  }
}
copyDir(join(ROOT, 'src', 'assets'), join(OUT, 'assets'));
copyDir(join(ROOT, 'src', 'vendor'), join(OUT, 'vendor'));
copyDir(join(ROOT, 'src', 'static'), OUT);

const hashes = {};
// /assets/* is cached as immutable, so every module import must carry a content hash too.
// Rewrite `from './x.js'` to `from './x.js?v=<hash>'`, dependencies first, so a change in
// lib.js also changes the hash of every module that imports it.
{
  const dir = join(OUT, 'assets', 'js');
  const done = new Map();
  const stamp = (file) => {
    if (done.has(file)) return done.get(file);
    const path = join(dir, file);
    const src = readFileSync(path, 'utf8').replace(/from '\.\/([\w-]+\.js)'/g, (_, dep) => `from './${dep}?v=${stamp(dep)}'`);
    writeFileSync(path, src);
    const h = createHash('sha1').update(src).digest('hex').slice(0, 10);
    done.set(file, h);
    return h;
  };
  for (const f of readdirSync(dir)) if (f.endsWith('.js')) stamp(f);
}
function asset(path) {
  if (!hashes[path]) hashes[path] = createHash('sha1').update(readFileSync(join(OUT, path))).digest('hex').slice(0, 10);
  return `/${path}?v=${hashes[path]}`;
}

// ---- Formatting helpers ----------------------------------------------------
const entryUrl = (e) => `/event/${e.slug}`;
const placeUrl = (p) => `/place/${p.slug}`;
const abs = (path) => SITE.url + path;
const catBadge = (id) => `<span class="cat" style="--c:${CATEGORY[id].color}"><span class="dot" aria-hidden="true"></span>${esc(CATEGORY[id].short)}</span>`;
const coords = (w) => `${Math.abs(w.lat).toFixed(4)}° ${w.lat >= 0 ? 'N' : 'S'}, ${Math.abs(w.lon).toFixed(4)}° ${w.lon >= 0 ? 'E' : 'W'}`;
const PRECISION = {
  site: 'Marker shows the specific site.',
  area: 'Marker shows the general area.',
  city: 'Marker shows the city, not a specific building.',
};
function spanLabel(list) {
  if (!list.length) return '';
  const a = Math.min(...list.map((e) => startYear(e.when)));
  const b = Math.max(...list.map((e) => endYear(e.when)));
  return a === b ? formatYear(a) : `${formatYear(a)} – ${formatYear(b)}`;
}
function isoDate(parts) {
  const [y, m, d] = parts;
  if (y < 1) return null;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return [p(y, 4), m && p(m), m && d && p(d)].filter(Boolean).join('-');
}
function img(e, { size = 'large', lazy = true, cls = '' } = {}) {
  const im = e.image && images[e.image.file];
  if (!im) return '';
  const src = size === 'small' ? im.srcSmall : im.src;
  const w = size === 'small' ? Math.min(500, im.width) : im.width;
  const h = Math.round((im.height / im.width) * w);
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(e.image.alt)}" width="${w}" height="${h}"${lazy ? ' loading="lazy"' : ''} decoding="async" referrerpolicy="no-referrer">`;
}
function credit(file) {
  const im = images[file];
  if (!im) return '';
  const lic = im.licenseUrl ? `<a href="${esc(im.licenseUrl)}" rel="license noopener" target="_blank">${esc(im.license)}</a>` : esc(im.license);
  const who = im.author ? `${esc(im.author)} · ` : '';
  return `${who}${lic} · <a href="${esc(im.page)}" rel="noopener" target="_blank">Wikimedia Commons</a>`;
}
// Placeholder for future advertising. Returns nothing in V1 so no empty boxes render.
const slot = (name) => `<!-- slot:${name} -->`;

// ---- Layout ----------------------------------------------------------------
const NAV = [['/', 'Explore'], ['/timeline', 'Timeline'], ['/places', 'Places'], ['/sources', 'Sources'], ['/about', 'About']];
function layout({ path, title, description, main, jsonld = [], ogImage, ogType = 'website', scripts = [], styles = [], bodyClass = '', noindex = false }) {
  const fullTitle = path === '/' ? `${SITE.name} — Interactive map of documented history` : `${title} — ${SITE.name}`;
  const canonical = abs(path);
  const navItem = ([href, label]) => {
    const current = href === '/' ? path === '/' : path === href || path.startsWith(href + '/') || (href === '/places' && path.startsWith('/place/'));
    return `<li><a href="${href}"${current ? ' aria-current="page"' : ''}>${label}</a></li>`;
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<meta name="theme-color" content="#f5efe3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16130f" media="(prefers-color-scheme: dark)">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title || SITE.name)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">\n<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="icon" href="/assets/img/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${asset('assets/css/site.css')}">
${styles.map((s) => `<link rel="stylesheet" href="${s}">`).join('\n')}
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><svg aria-hidden="true" viewBox="0 0 24 24" width="26" height="26"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg><span>What Happened Here?</span></a>
    <nav aria-label="Main"><ul>${NAV.map(navItem).join('')}</ul></nav>
  </div>
</header>
<main id="main">
${main}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div>
      <p class="footer-brand">What Happened Here?</p>
      <p>An interactive map of documented history. Every entry lists its sources; uncertain or disputed points are marked as such.</p>
    </div>
    <div>
      <p><a href="/about">About &amp; methodology</a> · <a href="/sources">All sources</a> · <a href="${SITE.repo}">Source code &amp; data</a></p>
      <p class="small">Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, tiles by <a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://openmaptiles.org">OpenMapTiles</a>. Images from <a href="https://commons.wikimedia.org">Wikimedia Commons</a> under the licences shown with each image. No cookies, accounts or tracking.</p>
    </div>
  </div>
</footer>
${[asset('assets/js/site.js'), ...scripts].map((s) => `<script type="module" src="${s}"></script>`).join('\n')}
</body>
</html>
`;
}

const breadcrumbLd = (items) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })),
});
const breadcrumbs = (items) => `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map(([name, path], i) => i === items.length - 1 ? `<li aria-current="page">${esc(name)}</li>` : `<li><a href="${path}">${esc(name)}</a></li>`).join('')}</ol></nav>`;

function entryCard(e, { headingLevel = 3 } = {}) {
  const place = e.where.place ? placeBySlug[e.where.place].name : e.where.country;
  return `<article class="card">
  <a class="card-link" href="${entryUrl(e)}">
    <div class="card-media">${img(e, { size: 'small' })}</div>
    <div class="card-body">
      ${catBadge(e.category)}
      <h${headingLevel} class="card-title">${esc(e.title)}</h${headingLevel}>
      <p class="card-meta">${esc(e.when.label)} · ${esc(place)}</p>
    </div>
  </a>
</article>`;
}

function timelineList(list) {
  return `<ol class="tl">${list.map((e) => `<li class="tl-item" style="--c:${CATEGORY[e.category].color}">
  <p class="tl-date">${esc(e.when.label)}${e.when.approx ? ' <span class="approx" title="Approximate date">approx.</span>' : ''}</p>
  <div class="tl-body">
    <h3><a href="${entryUrl(e)}">${esc(e.title)}</a></h3>
    <p class="tl-meta">${catBadge(e.category)} <span>${esc(e.where.name)}</span></p>
    <p>${esc(e.summary)}</p>
  </div>
</li>`).join('\n')}</ol>`;
}

function sourceList(sources) {
  return `<ol class="sources">${sources.map((s, i) => `<li id="src-${i + 1}"><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.title)}</a> — <span class="pub">${esc(s.publisher)}</span>${s.supports ? `<br><span class="supports">Used for: ${esc(s.supports)}</span>` : ''}</li>`).join('')}</ol>`;
}
const refs = (s) => s.map((n) => `<sup class="ref"><a href="#src-${n}" aria-label="Source ${n}">[${n}]</a></sup>`).join('');

function mapBlock(center, markers, label) {
  return `<div class="minimap" data-minimap='${esc(JSON.stringify({ center, markers }))}' role="region" aria-label="${esc(label)}">
  <p class="minimap-fallback">${esc(label)}: ${esc(coords({ lat: center[1], lon: center[0] }))}</p>
</div>`;
}

// ---- Client data ------------------------------------------------------------
const clientEntries = entries.map((e) => ({
  slug: e.slug, title: e.title, category: e.category, featured: !!e.featured,
  when: { label: e.when.label, start: e.when.start, end: e.when.end, approx: !!e.when.approx },
  where: { name: e.where.name, place: e.where.place || null, country: e.where.country, lat: e.where.lat, lon: e.where.lon },
  summary: e.summary, people: e.people, tags: e.tags,
  thumb: e.image && images[e.image.file] ? images[e.image.file].srcSmall : null,
}));
const clientPlaces = places.map((p) => ({ slug: p.slug, name: p.name, country: p.country, lat: p.lat, lon: p.lon, description: p.description, count: p.entries.length }));
write('data/entries.json', JSON.stringify({ entries: clientEntries, places: clientPlaces }));

const MAP_ASSETS = { css: `/vendor/${MAPLIBRE}/maplibre-gl.css`, js: `/vendor/${MAPLIBRE}/maplibre-gl-csp.js` };

// ---- Home -----------------------------------------------------------------------
{
  const minY = Math.min(...entries.map((e) => startYear(e.when)));
  const maxY = Math.max(...entries.map((e) => endYear(e.when)));
  const featured = entries.filter((e) => e.featured);
  const popular = [...places].sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name));
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, entries.filter((e) => e.category === c.id).length]));
  const main = `
<section class="hero">
  <div class="wrap">
    <h1>What Happened Here?</h1>
    <p class="lede">${esc(SITE.tagline)}</p>
    <form class="search" role="search" action="/" method="get" id="search-form">
      <label for="q" class="sr-only">Search cities, places, events, people and landmarks</label>
      <input id="q" name="q" type="search" placeholder="Search a city, event, person or landmark…" autocomplete="off" spellcheck="false">
      <button type="submit">Search</button>
    </form>
    <p class="hero-stats">${entries.length} sourced entries · ${places.length} place guides · ${esc(formatYear(minY))} to ${esc(formatYear(maxY))}</p>
  </div>
</section>

<section class="explorer" id="explore" aria-label="Map explorer">
  <div class="explorer-grid">
    <div class="panel">
      <div class="filters">
        <fieldset class="cats">
          <legend>Categories</legend>
          <div class="chips">
            ${CATEGORIES.map((c) => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="false" style="--c:${c.color}"><span class="dot" aria-hidden="true"></span>${esc(c.label)} <span class="n">${counts[c.id]}</span></button>`).join('\n            ')}
          </div>
        </fieldset>
        <fieldset class="timeline-filter">
          <legend>Timeline</legend>
          <div class="range" id="range">
            <div class="range-track" aria-hidden="true"><div class="range-dots" id="range-dots"></div><div class="range-fill" id="range-fill"></div></div>
            <input type="range" id="from-pos" min="0" max="1000" step="1" value="0" aria-label="Earliest year">
            <input type="range" id="to-pos" min="0" max="1000" step="1" value="1000" aria-label="Latest year">
          </div>
          <div class="range-ticks" id="range-ticks" aria-hidden="true"></div>
          <div class="range-inputs">
            <label>From <input id="from-year" type="text" inputmode="text" autocomplete="off" aria-describedby="year-help"></label>
            <label>To <input id="to-year" type="text" inputmode="text" autocomplete="off" aria-describedby="year-help"></label>
          </div>
          <p class="help" id="year-help">Type a year such as 1789, 44 BCE or AD 79.</p>
          <div class="eras" role="group" aria-label="Time periods">
            <button type="button" data-era="-3000,${maxY}">All time</button>
            <button type="button" data-era="-3000,500">Ancient</button>
            <button type="button" data-era="500,1500">Medieval</button>
            <button type="button" data-era="1500,1800">1500–1800</button>
            <button type="button" data-era="1800,1900">1800s</button>
            <button type="button" data-era="1900,${maxY}">1900–today</button>
          </div>
        </fieldset>
        <div class="filter-actions">
          <button type="button" id="near-me" class="btn-secondary">Near me</button>
          <button type="button" id="reset" class="btn-secondary">Reset filters</button>
        </div>
      </div>
      <p class="count" id="count" aria-live="polite">${entries.length} entries</p>
      <div id="place-hits"></div>
      <p class="empty" id="empty" hidden></p>
      <ol class="results" id="results">
        ${entries.map((e) => `<li class="result" data-slug="${e.slug}">
          <a class="result-link" href="${entryUrl(e)}"><span class="dot" style="--c:${CATEGORY[e.category].color}" aria-hidden="true"></span><span class="result-text"><span class="result-title">${esc(e.title)}</span><span class="result-meta">${esc(e.when.label)} · ${esc(e.where.place ? placeBySlug[e.where.place].name : e.where.country)}</span></span></a>
          <button type="button" class="locate" data-slug="${e.slug}" aria-label="Show ${esc(e.title)} on the map"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="3.5" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
        </li>`).join('\n        ')}
      </ol>
    </div>
    <div class="map-wrap">
      <div id="map" class="map" role="region" aria-label="Interactive map of historical entries. Use the list of results for keyboard access."></div>
      <div class="map-status" id="map-status">Loading map…</div>
      <div class="map-card" id="card" hidden>
        <button type="button" class="card-close" id="card-close" aria-label="Close">×</button>
        <div id="card-body"></div>
      </div>
    </div>
  </div>
</section>

${slot('home-after-explorer')}

<section class="section wrap" aria-labelledby="featured-h">
  <div class="section-head"><h2 id="featured-h">Featured events</h2><a href="/timeline">See the full timeline →</a></div>
  <div class="cards">${featured.map((e) => entryCard(e)).join('\n')}</div>
</section>

<section class="section wrap" aria-labelledby="popular-h">
  <div class="section-head"><h2 id="popular-h">Popular locations</h2><a href="/places">All places →</a></div>
  <p class="section-note">The places with the most entries in the collection so far.</p>
  <div class="place-cards">${popular.map((p) => `<a class="place-card" href="${placeUrl(p)}">
    ${img(p, { size: 'small' })}
    <span class="place-card-body"><span class="place-card-name">${esc(p.name)}</span><span class="place-card-meta">${p.entries.length} entries · ${esc(spanLabel(p.entries))}</span></span>
  </a>`).join('\n')}</div>
</section>

${slot('home-between-sections')}

<section class="section wrap" aria-labelledby="browse-h">
  <h2 id="browse-h">Browse by category</h2>
  <ul class="cat-grid">${CATEGORIES.map((c) => `<li><a href="/?cat=${c.id}#explore" style="--c:${c.color}"><span class="dot" aria-hidden="true"></span><span>${esc(c.label)}</span><span class="n">${counts[c.id]} entries</span></a></li>`).join('')}</ul>
</section>

<section class="section wrap method" aria-labelledby="method-h">
  <h2 id="method-h">How this map is made</h2>
  <div class="method-grid">
    <p><strong>Sourced.</strong> Every entry cites museums, archives, universities, government heritage bodies or established reference works, and each documented fact points to the source that supports it.</p>
    <p><strong>Honest about uncertainty.</strong> Approximate dates are shown as ranges, and disputed points sit in a separate “Uncertain or debated” section rather than being presented as fact.</p>
    <p><strong>Openly licensed images.</strong> Pictures come from Wikimedia Commons under public-domain or Creative Commons licences, credited on every page.</p>
  </div>
  <p><a href="/about">Read the full methodology →</a></p>
</section>
`;
  write('index.html', layout({
    path: '/', title: SITE.name,
    description: `Explore an interactive map of ${entries.length} documented historical events, landmarks, people, disasters, battles, inventions and cultural moments — each with sources.`,
    main, bodyClass: 'home', styles: [MAP_ASSETS.css], scripts: [asset('assets/js/home.js')],
    ogImage: images[bySlug['eiffel-tower'].image.file].src,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'WebSite', name: SITE.name, url: SITE.url + '/', description: SITE.tagline,
      potentialAction: { '@type': 'SearchAction', target: `${SITE.url}/?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
    }],
  }));
}

// ---- Entry pages ------------------------------------------------------------------
function aboutLd(e) {
  const geo = { '@type': 'GeoCoordinates', latitude: e.where.lat, longitude: e.where.lon };
  const place = { '@type': 'Place', name: e.where.name, geo, address: { '@type': 'PostalAddress', addressCountry: e.where.country } };
  if (e.category === 'landmark') return { '@type': 'LandmarksOrHistoricalBuildings', name: e.title, geo };
  if (e.category === 'person') return { '@type': 'Person', name: e.people[0] };
  const ev = { '@type': 'Event', name: e.title, location: place, eventStatus: 'https://schema.org/EventScheduled' };
  if (!e.when.approx) {
    const s = isoDate(e.when.start); const en = e.when.end && isoDate(e.when.end);
    if (s) ev.startDate = s;
    if (en) ev.endDate = en;
  }
  return ev;
}

for (const e of entries) {
  const place = e.where.place && placeBySlug[e.where.place];
  const im = e.image && images[e.image.file];
  const cat = CATEGORY[e.category];
  const related = (e.related || []).map((s) => bySlug[s]).filter(Boolean);
  const nearby = entries.filter((o) => o !== e && !related.includes(o))
    .map((o) => ({ o, d: distanceKm(e.where, o.where) }))
    .filter((x) => x.d < 400).sort((a, b) => a.d - b.d).slice(0, 4);
  const markers = [{ lat: e.where.lat, lon: e.where.lon, title: e.title, category: e.category, main: true },
    ...nearby.filter((x) => x.d < 25).map(({ o }) => ({ lat: o.where.lat, lon: o.where.lon, title: o.title, category: o.category, href: entryUrl(o) }))];
  const crumbs = [['Explore', '/'], ...(place ? [[place.name, placeUrl(place)]] : [[cat.label, `/?cat=${cat.id}#explore`]]), [e.title, entryUrl(e)]];
  const main = `
<article class="entry" style="--c:${cat.color}">
  <div class="wrap">
    ${breadcrumbs(crumbs)}
    <header class="entry-head">
      ${catBadge(e.category)}
      <h1>${esc(e.title)}</h1>
      <p class="entry-when"><time>${esc(e.when.label)}</time>${e.when.approx ? ' <span class="approx">Approximate date</span>' : ''}</p>
      <p class="entry-where">${esc(e.where.name)}${place ? ` · <a href="${placeUrl(place)}">More history in ${esc(place.name)}</a>` : ` · ${esc(e.where.country)}`}</p>
    </header>
  </div>
  ${im ? `<figure class="entry-figure wrap">
    ${img(e, { lazy: false })}
    <figcaption>${esc(e.image.caption)} <span class="credit">Image: ${credit(e.image.file)}</span></figcaption>
  </figure>` : ''}
  <div class="wrap entry-grid">
    <div class="entry-main prose">
      <p class="lead">${esc(e.summary)}</p>
      <section aria-labelledby="h-what"><h2 id="h-what">What happened</h2>${e.description.map((p) => `<p>${esc(p)}</p>`).join('')}</section>
      <section class="facts" aria-labelledby="h-facts"><h2 id="h-facts">Documented facts</h2>
        <p class="section-note">Each statement below is supported by the numbered source.</p>
        <ul>${e.facts.map((f) => `<li>${esc(f.text)} ${refs(f.s)}</li>`).join('')}</ul>
      </section>
      ${e.uncertain.length ? `<section class="uncertain" aria-labelledby="h-unc"><h2 id="h-unc">Uncertain or debated</h2>
        <p class="section-note">These points are disputed, estimated or not firmly documented.</p>
        <ul>${e.uncertain.map((f) => `<li>${esc(f.text)} ${refs(f.s)}</li>`).join('')}</ul>
      </section>` : ''}
      <section aria-labelledby="h-ctx"><h2 id="h-ctx">Historical context</h2>${e.context.map((p) => `<p>${esc(p)}</p>`).join('')}</section>
      ${slot('entry-after-content')}
      <section aria-labelledby="h-src"><h2 id="h-src">Sources and references</h2>${sourceList(e.sources)}
        <p class="small">Coordinates: <a href="https://www.wikidata.org/wiki/${e.where.wikidata}" rel="noopener" target="_blank">Wikidata ${e.where.wikidata}</a>. Summaries on this page are original text written from the sources above.</p>
      </section>
    </div>
    <aside class="entry-aside" aria-label="Details">
      <div class="facts-box">
        <h2 class="sr-only">Quick facts</h2>
        <dl>
          <dt>Date</dt><dd>${esc(e.when.label)}${e.when.note ? `<span class="note">${esc(e.when.note)}</span>` : ''}</dd>
          <dt>Location</dt><dd>${esc(e.where.name)}, ${esc(e.where.country)}<span class="note">${esc(coords(e.where))}. ${esc(e.where.note || PRECISION[e.where.precision])}</span></dd>
          <dt>Category</dt><dd><a href="/?cat=${cat.id}#explore">${esc(cat.label)}</a></dd>
          ${e.people.length ? `<dt>People</dt><dd>${e.people.map(esc).join(', ')}</dd>` : ''}
        </dl>
      </div>
      <section class="aside-map" aria-labelledby="h-map"><h2 id="h-map">On the map</h2>${mapBlock([e.where.lon, e.where.lat], markers, `Map of ${e.title}`)}
        <p class="small"><a href="/?focus=${e.slug}#explore">Open in the full map →</a></p>
      </section>
      ${slot('entry-sidebar')}
    </aside>
  </div>
  ${related.length || nearby.length ? `<section class="wrap section" aria-labelledby="h-rel"><h2 id="h-rel">Related entries</h2>
    <div class="cards">${[...related, ...nearby.map((x) => x.o)].slice(0, 6).map((o) => entryCard(o)).join('\n')}</div>
  </section>` : ''}
</article>`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'Article', headline: e.title, description: e.summary,
    url: abs(entryUrl(e)), mainEntityOfPage: abs(entryUrl(e)), inLanguage: 'en',
    image: im ? im.src : undefined, dateModified: buildDate,
    author: { '@type': 'Organization', name: SITE.name, url: SITE.url },
    publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
    about: aboutLd(e),
    contentLocation: { '@type': 'Place', name: e.where.name, geo: { '@type': 'GeoCoordinates', latitude: e.where.lat, longitude: e.where.lon } },
    citation: e.sources.map((s) => ({ '@type': 'CreativeWork', name: s.title, url: s.url, publisher: { '@type': 'Organization', name: s.publisher } })),
  };
  write(`event/${e.slug}.html`, layout({
    path: entryUrl(e), title: e.title, description: `${e.when.label}, ${e.where.name}: ${e.summary}`.slice(0, 300),
    main, ogType: 'article', ogImage: im && im.src, styles: [MAP_ASSETS.css], scripts: [asset('assets/js/minimap.js')],
    jsonld: [ld, breadcrumbLd(crumbs)],
  }));
}

// ---- Place pages --------------------------------------------------------------------
for (const p of places) {
  const list = p.entries;
  const people = list.filter((e) => e.people.length).flatMap((e) => e.people.map((name) => ({ name, e })));
  const landmarks = list.filter((e) => e.category === 'landmark');
  const otherPlaces = places.filter((o) => o !== p).map((o) => ({ o, d: distanceKm(p, o) })).sort((a, b) => a.d - b.d).slice(0, 4);
  const nearbyEntries = entries.filter((e) => e.where.place !== p.slug).map((e) => ({ e, d: distanceKm(p, e.where) })).filter((x) => x.d < 500).sort((a, b) => a.d - b.d).slice(0, 4);
  const markers = list.map((e) => ({ lat: e.where.lat, lon: e.where.lon, title: e.title, category: e.category, href: entryUrl(e) }));
  const crumbs = [['Explore', '/'], ['Places', '/places'], [p.name, placeUrl(p)]];
  const main = `
<div class="wrap place">
  ${breadcrumbs(crumbs)}
  <header class="entry-head">
    <p class="eyebrow">Place guide · ${esc(p.country)}</p>
    <h1>What happened in ${esc(p.name)}?</h1>
    <p class="lede">${esc(p.description)} This guide gathers ${list.length} documented entries spanning ${esc(spanLabel(list))}.</p>
  </header>
  <div class="place-top">
    <figure class="place-figure">${img(p, { lazy: false })}<figcaption>${esc(p.image.caption)} <span class="credit">Image: ${credit(p.image.file)}</span></figcaption></figure>
    <section aria-labelledby="h-map">
      <h2 id="h-map" class="sr-only">Map</h2>
      ${mapBlock([p.lon, p.lat], markers, `Map of historical entries in ${p.name}`)}
    </section>
  </div>
  <div class="entry-grid">
    <div class="entry-main">
      <section aria-labelledby="h-tl"><h2 id="h-tl">Timeline</h2>${timelineList(list)}</section>
      ${slot('place-after-timeline')}
    </div>
    <aside class="entry-aside">
      ${people.length ? `<section aria-labelledby="h-people"><h2 id="h-people">Notable people</h2><ul class="plain">${people.map(({ name, e }) => `<li><strong>${esc(name)}</strong><br><a href="${entryUrl(e)}">${esc(e.title)}</a></li>`).join('')}</ul></section>` : ''}
      ${landmarks.length ? `<section aria-labelledby="h-land"><h2 id="h-land">Historic landmarks</h2><ul class="plain">${landmarks.map((e) => `<li><a href="${entryUrl(e)}">${esc(e.title)}</a> <span class="muted">${esc(e.when.label)}</span></li>`).join('')}</ul></section>` : ''}
      <section aria-labelledby="h-rel"><h2 id="h-rel">Related locations</h2><ul class="plain">
        ${otherPlaces.map(({ o, d }) => `<li><a href="${placeUrl(o)}">${esc(o.name)}</a> <span class="muted">${Math.round(d).toLocaleString('en')} km away · ${o.entries.length} entries</span></li>`).join('')}
        ${nearbyEntries.map(({ e, d }) => `<li><a href="${entryUrl(e)}">${esc(e.title)}</a> <span class="muted">${Math.round(d)} km away</span></li>`).join('')}
      </ul></section>
      <section aria-labelledby="h-src"><h2 id="h-src">About this place description</h2>${sourceList(p.sources)}<p class="small">Each entry lists its own sources.</p></section>
      ${slot('place-sidebar')}
    </aside>
  </div>
</div>`;
  write(`place/${p.slug}.html`, layout({
    path: placeUrl(p), title: `History of ${p.name}: ${list.length} documented events and landmarks`,
    description: `What happened in ${p.name}? A map and timeline of ${list.length} sourced entries: ${list.map((e) => e.title).join(', ')}.`.slice(0, 300),
    main, ogImage: images[p.image.file]?.src, styles: [MAP_ASSETS.css], scripts: [asset('assets/js/minimap.js')],
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'Place', name: p.name, description: p.description, url: abs(placeUrl(p)),
      geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lon }, sameAs: `https://www.wikidata.org/wiki/${p.wikidata}`,
    }, breadcrumbLd(crumbs)],
  }));
}

// ---- Places index ------------------------------------------------------------------
{
  const byCountry = {};
  for (const e of entries) (byCountry[e.where.country] ||= []).push(e);
  const main = `
<div class="wrap">
  ${breadcrumbs([['Explore', '/'], ['Places', '/places']])}
  <header class="entry-head"><h1>Places</h1><p class="lede">Place guides collect several entries from the same city. Every other location is listed by country below.</p></header>
  <section class="section" aria-labelledby="h-guides"><h2 id="h-guides">Place guides</h2>
    <div class="place-cards">${places.map((p) => `<a class="place-card" href="${placeUrl(p)}">${img(p, { size: 'small' })}<span class="place-card-body"><span class="place-card-name">${esc(p.name)}</span><span class="place-card-meta">${p.entries.length} entries · ${esc(spanLabel(p.entries))}</span></span></a>`).join('\n')}</div>
  </section>
  <section class="section" aria-labelledby="h-countries"><h2 id="h-countries">All locations by country</h2>
    <div class="country-list">${Object.keys(byCountry).sort().map((c) => `<section><h3>${esc(c)}</h3><ul class="plain">${byCountry[c].map((e) => `<li><a href="${entryUrl(e)}">${esc(e.title)}</a> <span class="muted">${esc(e.where.name)}</span></li>`).join('')}</ul></section>`).join('')}</div>
  </section>
</div>`;
  write('places.html', layout({ path: '/places', title: 'Places', description: `Place guides for ${places.map((p) => p.name).join(', ')}, and every location in the collection by country.`, main }));
}

// ---- Timeline -----------------------------------------------------------------------
{
  const eras = [['Ancient world', -Infinity, 500], ['Middle Ages', 500, 1500], ['1500–1799', 1500, 1800], ['The 19th century', 1800, 1900], ['1900 to today', 1900, Infinity]];
  const main = `
<div class="wrap narrow">
  ${breadcrumbs([['Explore', '/'], ['Timeline', '/timeline']])}
  <header class="entry-head"><h1>Timeline</h1><p class="lede">All ${entries.length} entries in date order. Approximate dates are marked; where only a range is known, the range is shown.</p>
  <nav class="era-nav" aria-label="Jump to period"><ul>${eras.map(([n], i) => `<li><a href="#era-${i}">${esc(n)}</a></li>`).join('')}</ul></nav></header>
  ${eras.map(([name, a, b], i) => {
    const list = entries.filter((e) => startYear(e.when) >= a && startYear(e.when) < b);
    return list.length ? `<section class="section" aria-labelledby="era-${i}"><h2 id="era-${i}">${esc(name)}</h2>${timelineList(list)}</section>` : '';
  }).join('\n')}
</div>`;
  write('timeline.html', layout({ path: '/timeline', title: 'Timeline of documented history', description: `A chronological timeline of ${entries.length} sourced historical entries, from ${formatYear(startYear(entries[0].when))} to ${formatYear(Math.max(...entries.map((e) => endYear(e.when))))}.`, main }));
}

// ---- Sources ------------------------------------------------------------------------
{
  const pubs = {};
  for (const e of entries) for (const s of e.sources) {
    const p = (pubs[s.publisher] ||= new Map());
    if (!p.has(s.url)) p.set(s.url, { ...s, entries: [] });
    p.get(s.url).entries.push(e);
  }
  const names = Object.keys(pubs).sort((a, b) => pubs[b].size - pubs[a].size || a.localeCompare(b));
  const total = names.reduce((n, k) => n + pubs[k].size, 0);
  const main = `
<div class="wrap narrow">
  ${breadcrumbs([['Explore', '/'], ['Sources', '/sources']])}
  <header class="entry-head"><h1>Sources</h1><p class="lede">${total} references from ${names.length} publishers are cited across the collection, grouped here by publisher.</p></header>
  ${names.map((n) => `<section class="source-group"><h2>${esc(n)}</h2><ul class="plain">${[...pubs[n].values()].map((s) => `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.title)}</a><br><span class="muted">Cited in: ${s.entries.map((e) => `<a href="${entryUrl(e)}">${esc(e.title)}</a>`).join(', ')}</span></li>`).join('')}</ul></section>`).join('\n')}
</div>`;
  write('sources.html', layout({ path: '/sources', title: 'Sources and references', description: `Every source cited on What Happened Here?, grouped by publisher: ${names.slice(0, 8).join(', ')} and more.`, main }));
}

// ---- About --------------------------------------------------------------------------
write('about.html', layout({
  path: '/about', title: 'About and methodology', description: 'How What Happened Here? researches, sources and presents historical entries, and how images and map data are licensed.',
  main: readFileSync(join(ROOT, 'src', 'pages', 'about.html'), 'utf8')
    .replace('{{crumbs}}', breadcrumbs([['Explore', '/'], ['About', '/about']]))
    .replaceAll('{{count}}', String(entries.length)).replaceAll('{{repo}}', SITE.repo),
}));

// ---- 404 ------------------------------------------------------------------------------
write('404.html', layout({
  path: '/404', title: 'Page not found', description: 'This page does not exist on What Happened Here? Explore the map or browse the timeline instead.', noindex: true,
  main: `<div class="wrap narrow notfound"><h1>Nothing happened here — yet.</h1><p class="lede">We couldn't find that page. It may have moved, or the address may be mistyped.</p><p><a class="btn" href="/">Explore the map</a> <a class="btn-secondary" href="/timeline">Browse the timeline</a></p></div>`,
}));

// ---- Sitemap and robots -----------------------------------------------------------------
{
  const urls = ['/', '/timeline', '/places', '/sources', '/about', ...places.map(placeUrl), ...entries.map(entryUrl)];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${abs(u)}</loc><lastmod>${buildDate}</lastmod></url>`).join('\n')}
</urlset>
`);
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\n`);
}

const count = (dir) => readdirSync(join(OUT, dir)).length;
console.log(`Built ${entries.length} entry pages, ${places.length} place pages (${count('event')} + ${count('place')} files) into site/`);
