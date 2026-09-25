// Research / link-check helper: loads pages in headless Chrome (many reference sites
// refuse plain HTTP clients) and saves each page's visible text to .cache/pages/.
//
//   node scripts/fetch-pages.mjs <url> [url...]
//   node scripts/fetch-pages.mjs --sources      (every source URL in data/entries + data/places)
//
// Prints one JSON line per URL: status, final URL, title, text length and cache file.
// Uses Chrome, Chromium or Edge when installed (set CHROME_PATH to override); otherwise
// falls back to plain HTTP requests, which some sites (e.g. Britannica) will refuse.
// Requires Node 20+ (global fetch/WebSocket).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache', 'pages');
const PROFILE = join(ROOT, '.cache', 'chrome-profile');
const CHROME = process.env.FETCH_MODE === 'plain' ? null : [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
].find((p) => p && existsSync(p));
const PORT = 9300 + Math.floor(Math.random() * 500);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

mkdirSync(CACHE, { recursive: true });
mkdirSync(PROFILE, { recursive: true });

export const cacheFile = (url) => join(CACHE, createHash('sha1').update(url).digest('hex').slice(0, 16) + '.txt');

function sourceUrls() {
  const urls = new Set();
  const dir = join(ROOT, 'data', 'entries');
  for (const f of readdirSync(dir)) for (const s of JSON.parse(readFileSync(join(dir, f), 'utf8')).sources) urls.add(s.url);
  const places = join(ROOT, 'data', 'places.json');
  if (existsSync(places)) for (const p of JSON.parse(readFileSync(places, 'utf8'))) for (const s of p.sources || []) urls.add(s.url);
  return [...urls];
}

// Never replace a good cached copy with an error or bot-check page.
function saveIfGood(url, status, content, text) {
  if (status && status < 400 && (text || '').length >= 500) writeFileSync(cacheFile(url), content);
  else if (!existsSync(cacheFile(url))) writeFileSync(cacheFile(url), content);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForChrome() {
  for (let i = 0; i < 100; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(150); }
  }
  throw new Error('Chrome did not start');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('socket closed')); pending.clear(); };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else for (const l of listeners) l(msg);
  };
  return new Promise((ok, fail) => {
    ws.onerror = fail;
    ws.onopen = () => ok({
      send: (method, params = {}) => new Promise((res, rej) => {
        const n = ++id;
        const timer = setTimeout(() => { pending.delete(n); rej(new Error(method + ' timed out')); }, 30000);
        pending.set(n, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
      on: (fn) => listeners.push(fn),
      close: () => ws.close(),
    });
  });
}

async function load(url) {
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(target.webSocketDebuggerUrl);
  let loaded = false;
  const docs = [];
  c.on((m) => {
    if (m.method === 'Network.responseReceived' && m.params.type === 'Document') docs.push({ frameId: m.params.frameId, status: m.params.response.status, url: m.params.response.url });
    if (m.method === 'Page.loadEventFired') loaded = true;
  });
  await c.send('Network.enable');
  await c.send('Network.setUserAgentOverride', { userAgent: UA, acceptLanguage: 'en-GB,en;q=0.9' });
  await c.send('Page.enable');
  const nav = await c.send('Page.navigate', { url });
  for (let i = 0; i < 100 && !loaded; i++) await sleep(200);
  await sleep(1500);
  // innerText misses collapsed sections (accordions, tabs), so append the full text content too.
  const expression = `(() => {
    if (!document.body) return JSON.stringify({ title: document.title, text: '' });
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, template, svg').forEach((n) => n.remove());
    const hidden = clone.textContent.replace(/\\s+/g, ' ');
    return JSON.stringify({ title: document.title, text: document.body.innerText + '\\n\\n--- full text ---\\n' + hidden });
  })()`;
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true });
  c.close();
  const main = docs.filter((d) => d.frameId === nav.frameId).pop() || {};
  const status = main.status ?? null; const finalUrl = main.url || url;
  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
  const { title, text } = JSON.parse(r.result.value || '{}');
  saveIfGood(url, status, `URL: ${url}\nFINAL: ${finalUrl}\nSTATUS: ${status}\nTITLE: ${title}\n\n${text}`, text);
  return { url, status, finalUrl: finalUrl !== url ? finalUrl : undefined, title: (title || '').slice(0, 90), chars: (text || '').length, file: cacheFile(url).slice(ROOT.length + 1) };
}

// Fallback without a browser: plain request, HTML stripped to text.
async function loadPlain(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' }, redirect: 'follow' });
  const html = await res.text();
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const text = html.replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
  saveIfGood(url, res.status, `URL: ${url}
FINAL: ${res.url}
STATUS: ${res.status}
TITLE: ${title}

${text}`, text);
  return { url, status: res.status, finalUrl: res.url !== url ? res.url : undefined, title: title.slice(0, 90), chars: text.length, file: cacheFile(url).slice(ROOT.length + 1), mode: 'plain' };
}

const needsAttention = (r) => r.error || !r.status || r.status >= 400 || r.chars < 500;
const args = process.argv.slice(2);
const urls = args[0] === '--sources' ? sourceUrls() : args;
if (!CHROME) console.warn('No Chrome/Chromium/Edge found: using plain HTTP requests. Some reference sites block these; set CHROME_PATH for full coverage.');
const chrome = CHROME && spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
try {
  if (chrome) await waitForChrome();
  const get = async (u) => { try { return chrome ? await load(u) : await loadPlain(u); } catch (e) { return { url: u, error: e.message }; } };
  const queue = [...urls];
  const results = [];
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const u = queue.shift();
      let r = await get(u);
      if (needsAttention(r)) r = await get(u); // one retry: bot checks and slow pages are often transient
      results.push(r);
      console.log(JSON.stringify(r));
    }
  }));
  const bad = results.filter(needsAttention);
  console.log(`
${results.length} pages, ${bad.length} need attention`);
  if (args[0] === '--sources' && bad.length) process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
}
