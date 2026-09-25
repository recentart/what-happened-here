// Research helper: resolves English Wikipedia titles to coordinates, Wikidata IDs
// and freely licensed Commons images, so coordinates and image licences are copied
// from the source APIs instead of being typed by hand.
//
//   node scripts/lookup.mjs "Eiffel Tower" "Place de la Bastille"
//   node scripts/lookup.mjs --json titles.json   (array of titles)
//
// Output is printed for a human to review before anything goes into data/.

import { readFileSync } from 'node:fs';

const UA = 'what-happened-here-research/1.0 (https://github.com/recentart/what-happened-here)';

async function api(host, params) {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export async function lookupTitles(titles) {
  const pages = new Map();
  for (const part of chunk(titles, 50)) {
    const data = await api('en.wikipedia.org', {
      action: 'query', redirects: '1', prop: 'coordinates|pageprops', ppprop: 'wikibase_item',
      coprimary: 'primary', titles: part.join('|'),
    });
    const norm = new Map();
    for (const n of data.query.normalized || []) norm.set(n.from, n.to);
    for (const r of data.query.redirects || []) norm.set(r.from, r.to);
    for (const t of part) {
      let target = t;
      while (norm.has(target)) target = norm.get(target);
      const p = data.query.pages.find((pg) => pg.title === target);
      pages.set(t, p ? {
        title: p.title, missing: !!p.missing,
        qid: p.pageprops?.wikibase_item || null,
        lat: p.coordinates?.[0]?.lat ?? null, lon: p.coordinates?.[0]?.lon ?? null,
      } : { title: target, missing: true });
    }
  }
  return pages;
}

export async function wikidata(qids) {
  const out = new Map();
  for (const part of chunk(qids.filter(Boolean), 50)) {
    const data = await api('www.wikidata.org', { action: 'wbgetentities', ids: part.join('|'), props: 'claims|labels|descriptions', languages: 'en' });
    for (const [id, e] of Object.entries(data.entities)) {
      const coord = e.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      out.set(id, {
        label: e.labels?.en?.value, description: e.descriptions?.en?.value,
        lat: coord?.latitude ?? null, lon: coord?.longitude ?? null,
        images: (e.claims?.P18 || []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean),
      });
    }
  }
  return out;
}

export async function commons(files, width = 1280) {
  const out = new Map();
  for (const part of chunk(files, 50)) {
    const data = await api('commons.wikimedia.org', {
      action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: String(width),
      titles: part.map((f) => (f.startsWith('File:') ? f : 'File:' + f)).join('|'),
    });
    const norm = new Map((data.query.normalized || []).map((n) => [n.to, n.from]));
    for (const p of data.query.pages) {
      const ii = p.imageinfo?.[0];
      if (!ii) { out.set(p.title, { missing: true }); continue; }
      const m = ii.extmetadata || {};
      out.set(p.title, {
        file: p.title,
        requested: norm.get(p.title) || p.title,
        page: ii.descriptionurl,
        thumb: ii.thumburl, width: ii.thumbwidth, height: ii.thumbheight,
        original: ii.url, mime: ii.mime,
        license: m.LicenseShortName?.value || null,
        licenseUrl: m.LicenseUrl?.value || null,
        usageTerms: m.UsageTerms?.value || null,
        attributionRequired: m.AttributionRequired?.value || null,
        artist: stripHtml(m.Artist?.value),
        credit: stripHtml(m.Credit?.value),
        description: stripHtml(m.ImageDescription?.value).slice(0, 300),
        date: stripHtml(m.DateTimeOriginal?.value),
        restrictions: m.Restrictions?.value || '',
      });
    }
  }
  return out;
}

// Licences the site accepts: public domain, CC0, CC BY and CC BY-SA.
export function licenceOk(license) {
  if (!license) return false;
  return /^(public domain|pd\b|pd-|cc0|cc by(-sa)? \d)/i.test(license.trim());
}

if (process.argv[1] && /[\\/]scripts[\\/]lookup\.mjs$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const titles = args[0] === '--json' ? JSON.parse(readFileSync(args[1], 'utf8')) : args;
  const pages = await lookupTitles(titles);
  const wd = await wikidata([...pages.values()].map((p) => p.qid));
  const files = [...new Set([...wd.values()].flatMap((w) => w.images))];
  const imgs = files.length ? await commons(files) : new Map();
  for (const t of titles) {
    const p = pages.get(t);
    const w = p?.qid ? wd.get(p.qid) : null;
    console.log(JSON.stringify({
      query: t, title: p?.title, missing: p?.missing, qid: p?.qid,
      wp: [p?.lat, p?.lon], wd: w ? [w.lat, w.lon] : null, label: w?.label, desc: w?.description,
      images: (w?.images || []).map((f) => {
        const i = imgs.get('File:' + f);
        return i ? { file: f, license: i.license, ok: licenceOk(i.license), artist: i.artist.slice(0, 80), date: i.date.slice(0, 40) } : { file: f, missing: true };
      }),
    }));
  }
}
