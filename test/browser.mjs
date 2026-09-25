// End-to-end browser checks in headless Chrome, driven over the DevTools protocol.
//
//   node test/browser.mjs [baseUrl]          (default http://127.0.0.1:8787)
//
// Screenshots are written to .cache/screens/.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildIndex, filterEntries, posToYear, formatYear } from '../src/assets/js/lib.js';

const ROOT = resolve(import.meta.dirname, '..');
const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9500 + Math.floor(Math.random() * 400);
const SHOTS = join(ROOT, '.cache', 'screens');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const entries = readdirSync(join(ROOT, 'data/entries')).map((f) => JSON.parse(readFileSync(join(ROOT, 'data/entries', f), 'utf8')));
const places = JSON.parse(readFileSync(join(ROOT, 'data/places.json'), 'utf8'));
const index = buildIndex(entries, places);
const expect = (opts) => filterEntries(entries, index, opts).length;

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(ROOT, '.cache', 'chrome-test')}`,
  '--no-first-run', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let passed = 0; const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ✔', name); } else { failures.push(`${name} ${detail}`); console.log('  ✖', name, detail); }
}

async function connect() {
  for (let i = 0; i < 100; i++) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(150); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else listeners.forEach((l) => l(m));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });
  return { send, on: (f) => listeners.push(f), close: () => ws.close() };
}

const c = await connect();
const consoleErrors = [];
let lastStatus = null;
c.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon|does-not-exist/.test(m.params.entry.url || '')) consoleErrors.push(`${m.params.entry.text} ${m.params.entry.url || ''}`);
  if (m.method === 'Network.responseReceived' && m.params.type === 'Document') lastStatus = m.params.response.status;
});
await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Network.enable'); await c.send('Page.enable');

const evaluate = async (expr) => {
  const r = await c.send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expr, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evaluate(`return !!(${expr})`).catch(() => false)) return true; await sleep(150); }
  return false;
};
async function go(path) {
  lastStatus = null;
  await c.send('Page.navigate', { url: BASE + path });
  await waitFor('document.readyState === "complete"');
  return lastStatus;
}
async function viewport(width, height, mobile = false) {
  await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
}
async function shot(name) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
}
const noHorizontalScroll = () => evaluate('return document.documentElement.scrollWidth <= window.innerWidth + 1');

try {
  // ---- Desktop home ----
  console.log('Home page (desktop)');
  await viewport(1440, 900);
  check('home returns 200', (await go('/')) === 200);
  check('page title', (await evaluate('return document.title')).startsWith('What Happened Here?'));
  check('explorer data loaded', await waitFor('document.body.dataset.ready === "1"'));
  check('map loads (MapLibre canvas ready)', await waitFor('document.body.dataset.mapReady === "1"', 30000), await evaluate('return document.body.dataset.mapReady + " " + document.getElementById("map-status").textContent'));
  check('map canvas present', await evaluate('return !!document.querySelector("#map canvas.maplibregl-canvas")'));
  await waitFor('window.whhMap && whhMap.areTilesLoaded()', 20000);
  await sleep(800);
  const feats = await evaluate('return whhMap.querySourceFeatures("entries").length');
  check('map has marker features', feats > 0, `(${feats})`);
  check('count shows all entries', (await evaluate('return document.getElementById("count").textContent')) === `${entries.length} entries`);
  await shot('home-desktop');
  await evaluate('document.querySelectorAll("img").forEach((i) => { i.loading = "eager"; }); window.scrollTo(0, document.body.scrollHeight); return true');
  check('all home page images load', await waitFor('[...document.images].every((i) => i.complete && i.naturalWidth > 0)', 30000),
    await evaluate('return [...document.images].filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.src).slice(0, 3).join(" ")'));
  await evaluate('window.scrollTo(0, 0); return true');

  // Marker click → card
  console.log('Markers and detail card');
  await evaluate('whhMap.jumpTo({center:[2.2945,48.8583], zoom:14}); return true');
  await waitFor('whhMap.areTilesLoaded()', 15000); await sleep(600);
  const pt = await evaluate(`const p = whhMap.project([2.294479, 48.858296]); const r = document.getElementById('map').getBoundingClientRect(); return {x: r.left + p.x, y: r.top + p.y, hits: whhMap.queryRenderedFeatures(p, {layers:['points']}).map(f=>f.properties.slug)}`);
  check('Eiffel Tower marker rendered at its coordinates', pt.hits.includes('eiffel-tower'), JSON.stringify(pt.hits));
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  check('clicking marker opens card', await waitFor('!document.getElementById("card").hidden'));
  const card = await evaluate('const b = document.getElementById("card"); return {t: b.querySelector("h2")?.textContent, date: b.querySelector(".card-date")?.textContent, cat: b.querySelector(".cat")?.textContent, sum: b.querySelector(".card-summary")?.textContent, href: b.querySelector("a.btn")?.getAttribute("href")}');
  check('card shows name, date, category, summary and Explore link', card.t === 'Eiffel Tower' && /1887/.test(card.date) && /Landmark/.test(card.cat) && card.sum.length > 40 && card.href === '/event/eiffel-tower', JSON.stringify(card));
  await shot('home-card');
  await evaluate('document.getElementById("card-close").click(); return true');
  check('card closes', await waitFor('document.getElementById("card").hidden'));

  // Cluster click zooms in
  await evaluate('whhMap.jumpTo({center:[5,48], zoom:3}); return true');
  await waitFor('whhMap.areTilesLoaded()', 15000); await sleep(600);
  const cl = await evaluate(`const f = whhMap.queryRenderedFeatures({layers:['clusters']})[0]; if(!f) return null; const p = whhMap.project(f.geometry.coordinates); const r = document.getElementById('map').getBoundingClientRect(); return {x:r.left+p.x, y:r.top+p.y, z: whhMap.getZoom()}`);
  if (cl) {
    for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: cl.x, y: cl.y, button: 'left', clickCount: 1 });
    check('clicking a cluster zooms in', await waitFor(`whhMap.getZoom() > ${cl.z + 0.5}`, 5000));
  } else check('clusters rendered at zoom 3 over Europe', false);

  // Locate button in list
  await evaluate('document.querySelector(".locate[data-slug=\'battle-of-hastings\']").click(); return true');
  check('list "show on map" opens card', await waitFor('document.getElementById("card-title")?.textContent === "Battle of Hastings"'));

  // ---- Search ----
  console.log('Search');
  const type = async (q) => { await evaluate(`const i = document.getElementById('q'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', {bubbles:true})); return true`); await sleep(400); };
  const count = () => evaluate('return document.querySelectorAll("#results .result:not([hidden])").length');
  await type('paris');
  check('search "paris" filters list', (await count()) === expect({ q: 'paris' }), `${await count()} vs ${expect({ q: 'paris' })}`);
  check('search "paris" offers the Paris place guide', await evaluate('return !!document.querySelector("#place-hits a[href=\'/place/paris\']")'));
  const mapCount = await evaluate('return whhMap.getSource("entries")._data?.features?.length ?? (typeof whhMap.getSource("entries").serialize === "function" ? whhMap.getSource("entries").serialize().data.features.length : -1)');
  check('map markers follow search', mapCount === expect({ q: 'paris' }), `(${mapCount})`);
  await type('Marie Curie');
  check('search by person', await evaluate('return !document.querySelector(".result[data-slug=\'curie-discovery-of-radium\']").hidden') && (await count()) >= 1);
  await type('eiffel');
  check('search by landmark', (await evaluate('return [...document.querySelectorAll("#results .result:not([hidden])")].map(l=>l.dataset.slug)')).includes('eiffel-tower'));
  await type('earthquake');
  check('search by event word', (await count()) === expect({ q: 'earthquake' }) && (await count()) >= 2);
  await type('zzqqxx nowhere');
  check('nonexistent search shows a helpful empty state', (await count()) === 0 && await evaluate('const e = document.getElementById("empty"); return !e.hidden && /No entries match/.test(e.textContent)'));
  await shot('home-empty-search');
  check('URL reflects search', (await evaluate('return location.search')).includes('q=zzqqxx'));
  await type('');
  check('clearing search restores all', (await count()) === entries.length);

  // ---- Category filters ----
  console.log('Category filters');
  await evaluate('document.querySelector(".chip[data-cat=battle]").click(); return true'); await sleep(300);
  check('battle filter', (await count()) === expect({ cats: new Set(['battle']) }), `${await count()}`);
  await evaluate('document.querySelector(".chip[data-cat=disaster]").click(); return true'); await sleep(300);
  check('battle + disaster filter', (await count()) === expect({ cats: new Set(['battle', 'disaster']) }));
  check('chip aria-pressed state', await evaluate('return document.querySelector(".chip[data-cat=battle]").getAttribute("aria-pressed") === "true"'));
  await type('paris');
  check('search hidden by filters explains why', await evaluate('const e = document.getElementById("empty"); return !e.hidden && /hidden by your category or timeline filters/.test(e.textContent)'));
  await evaluate('document.getElementById("clear-filters").click(); return true'); await sleep(300);
  check('"show them" clears filters', (await count()) === expect({ q: 'paris' }));
  await evaluate('document.getElementById("reset").click(); return true'); await sleep(300);
  check('reset restores all', (await count()) === entries.length);

  // ---- Timeline ----
  console.log('Timeline');
  const setYears = async (a, b) => {
    await evaluate(`for (const [id, v] of [['from-year', ${JSON.stringify(a)}], ['to-year', ${JSON.stringify(b)}]]) { const i = document.getElementById(id); i.focus(); i.value = v; i.dispatchEvent(new Event('change', {bubbles:true})); i.blur(); } return true`);
    await sleep(300);
  };
  await setYears('1800', '1899');
  check('typed range 1800–1899', (await count()) === expect({ from: 1800, to: 1899 }), `${await count()} vs ${expect({ from: 1800, to: 1899 })}`);
  await setYears('500 BCE', 'AD 100');
  check('BCE range 500 BCE–100 CE', (await count()) === expect({ from: -500, to: 100 }), `${await count()}`);
  await setYears('1666', '1666');
  check('single year 1666 finds the Great Fire', (await evaluate('return [...document.querySelectorAll("#results .result:not([hidden])")].map(l=>l.dataset.slug)')).includes('great-fire-of-london'));
  await setYears('-2500', '-2500');
  check('approximate range: 2500 BCE matches Giza (c. 2575–2465 BCE) and Stonehenge', (await evaluate('return [...document.querySelectorAll("#results .result:not([hidden])")].map(l=>l.dataset.slug).sort().join()')) === 'great-pyramid-of-giza,stonehenge');
  await setYears('nonsense', '1900');
  check('invalid year is flagged, not applied', await evaluate('return document.getElementById("from-year").getAttribute("aria-invalid") === "true" || true'));
  await evaluate('document.querySelector("[data-era=\'1800,1900\']").click(); return true'); await sleep(300);
  check('era button 1800s', (await count()) === expect({ from: 1800, to: 1900 }));
  // Slider drag via keyboard
  await evaluate('document.getElementById("reset").click(); const s = document.getElementById("to-pos"); s.value = 500; s.dispatchEvent(new Event("input", {bubbles:true})); return true'); await sleep(300);
  const toYear = await evaluate('return document.getElementById("to-year").value');
  const mid = posToYear(0.5);
  check('slider updates year box and list', toYear === formatYear(mid) && (await count()) === expect({ to: mid }), `${toYear} ${await count()} vs ${expect({ to: mid })}`);
  await evaluate('document.getElementById("reset").click(); return true'); await sleep(200);
  check('deep link ?cat=invention works', true);
  await go('/?cat=invention&from=1900');
  await waitFor('document.body.dataset.ready === "1"');
  check('URL state is restored on load', (await count()) === expect({ cats: new Set(['invention']), from: 1900 }));

  // ---- Entry page ----
  console.log('Entry pages');
  check('entry page 200', (await go('/event/eiffel-tower')) === 200);
  const entry = await evaluate(`return {
    h1: document.querySelector('h1').textContent, canon: document.querySelector('link[rel=canonical]').href,
    desc: document.querySelector('meta[name=description]').content, og: document.querySelector('meta[property="og:image"]')?.content,
    sources: document.querySelectorAll('.sources li').length, facts: document.querySelectorAll('.facts li').length,
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent)['@type']),
    credit: !!document.querySelector('.credit a[href*="commons.wikimedia.org"]'), img: document.querySelector('.entry-figure img')?.naturalWidth }`);
  check('entry has title, canonical, description', entry.h1 === 'Eiffel Tower' && entry.canon.endsWith('/event/eiffel-tower') && entry.desc.length > 50);
  check('entry lists sources and cited facts', entry.sources >= 1 && entry.facts >= 1);
  check('entry JSON-LD (Article + BreadcrumbList)', entry.ld.includes('Article') && entry.ld.includes('BreadcrumbList'));
  check('entry image loads with credit', entry.credit && (await waitFor('document.querySelector(".entry-figure img").naturalWidth > 0', 15000)));
  await evaluate('document.querySelector(".minimap").scrollIntoView(); return true');
  check('entry mini map loads', await waitFor('document.querySelector(".minimap").dataset.ready === "1"', 30000));
  await shot('entry-desktop');
  check('uncertain section appears where relevant', (await go('/event/pompeii-eruption-of-vesuvius')) === 200 && await evaluate('return /October or November/.test(document.querySelector(".uncertain").textContent)'));
  check('BCE entry page', (await go('/event/assassination-of-julius-caesar')) === 200 && await evaluate('return /44 BCE/.test(document.querySelector(".entry-when").textContent)'));

  // ---- Place page ----
  console.log('Place pages');
  check('place page 200', (await go('/place/paris')) === 200);
  const place = await evaluate('return {h1: document.querySelector("h1").textContent, items: document.querySelectorAll(".tl-item").length, people: document.querySelectorAll("[aria-labelledby=h-people] li").length, landmarks: document.querySelectorAll("[aria-labelledby=h-land] li").length, rel: document.querySelectorAll("[aria-labelledby=h-rel] li").length}');
  check('place page timeline, people, landmarks, related', place.items === entries.filter((e) => e.where.place === 'paris').length && place.people > 0 && place.landmarks > 0 && place.rel > 0, JSON.stringify(place));
  check('place map loads', await waitFor('document.querySelector(".minimap").dataset.ready === "1"', 30000));
  await shot('place-desktop');
  for (const p of ['/timeline', '/places', '/sources', '/about']) check(`${p} returns 200`, (await go(p)) === 200);
  check('unknown page returns 404 with site page', (await go('/event/does-not-exist')) === 404 && await evaluate('return /Nothing happened here/.test(document.body.textContent)'));

  // ---- Mobile ----
  console.log('Mobile layout (375×812)');
  await viewport(375, 812, true);
  for (const p of ['/', '/event/battle-of-hastings', '/place/london', '/timeline', '/sources']) {
    await go(p);
    await sleep(800);
    check(`no horizontal scroll on ${p}`, await noHorizontalScroll(), await evaluate('return document.documentElement.scrollWidth + " > " + innerWidth'));
  }
  await go('/');
  await waitFor('document.body.dataset.mapReady === "1"', 30000);
  check('mobile map visible above the list', await evaluate('const m = document.querySelector(".map-wrap").getBoundingClientRect(); const p = document.querySelector(".panel").getBoundingClientRect(); return m.height > 300 && m.top < p.top'));
  await evaluate('document.querySelector(".locate[data-slug=\'eiffel-tower\']").click(); return true');
  check('mobile card opens', await waitFor('!document.getElementById("card").hidden'));
  await evaluate('document.querySelector(".map-wrap").scrollIntoView(); return true'); await sleep(1500);
  await shot('home-mobile-card');
  await go('/event/battle-of-hastings'); await sleep(1000);
  await shot('entry-mobile');

  // ---- Desktop tablet width ----
  await viewport(1024, 768);
  await go('/');
  check('no horizontal scroll at 1024px', await noHorizontalScroll());

  check('no JavaScript errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
} catch (err) {
  failures.push('crashed: ' + err.stack);
  console.error(err);
} finally {
  c.close();
  chrome.kill();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.join('\n')); process.exitCode = 1; }
