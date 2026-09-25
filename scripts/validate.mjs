// Data checks shared by the build and `npm run validate`.
// Every entry must have sources, and every fact must point at an existing source.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATEGORY } from '../src/assets/js/lib.js';

const PRECISIONS = ['site', 'area', 'city'];
const LICENCE = /^(public domain|cc0|cc by(-sa)? \d)/i;

export function validate(root) {
  const errors = [];
  const warnings = [];
  const dir = join(root, 'data', 'entries');
  const entries = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const e = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (e.slug + '.json' !== f) errors.push(`${f}: slug "${e.slug}" does not match file name`);
    return e;
  });
  const places = JSON.parse(readFileSync(join(root, 'data', 'places.json'), 'utf8'));
  const images = JSON.parse(readFileSync(join(root, 'data', 'images.json'), 'utf8'));
  const slugs = new Set(entries.map((e) => e.slug));
  const placeSlugs = new Set(places.map((p) => p.slug));

  const checkSources = (id, sources) => {
    if (!Array.isArray(sources) || !sources.length) { errors.push(`${id}: no sources`); return; }
    for (const s of sources) {
      if (!s.title || !s.publisher || !/^https:\/\//.test(s.url || '')) errors.push(`${id}: source missing title, publisher or https URL`);
    }
    const urls = sources.map((s) => s.url);
    if (new Set(urls).size !== urls.length) errors.push(`${id}: duplicate source URL`);
  };
  const checkImage = (id, image) => {
    if (!image) { warnings.push(`${id}: no image`); return; }
    const im = images[image.file];
    if (!im) errors.push(`${id}: image "${image.file}" missing from data/images.json (run npm run images)`);
    else if (!LICENCE.test(im.license)) errors.push(`${id}: image licence "${im.license}" not accepted`);
    if (!image.alt || !image.caption) errors.push(`${id}: image needs alt text and a caption`);
  };

  for (const e of entries) {
    const id = e.slug;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.slug)) errors.push(`${id}: bad slug`);
    for (const k of ['title', 'summary']) if (!e[k] || typeof e[k] !== 'string') errors.push(`${id}: missing ${k}`);
    if (!CATEGORY[e.category]) errors.push(`${id}: unknown category "${e.category}"`);
    // Dates
    const w = e.when || {};
    const okParts = (p) => Array.isArray(p) && p.length >= 1 && p.length <= 3 && Number.isInteger(p[0]) && p[0] !== 0
      && (p[1] === undefined || (p[1] >= 1 && p[1] <= 12)) && (p[2] === undefined || (p[2] >= 1 && p[2] <= 31));
    if (!w.label || !okParts(w.start)) errors.push(`${id}: when needs a label and a valid start [year, month?, day?]`);
    if (w.end && !okParts(w.end)) errors.push(`${id}: invalid end date`);
    if (w.end && okParts(w.start) && okParts(w.end)) {
      const k = (p) => p[0] * 10000 + (p[1] || 0) * 100 + (p[2] || 0);
      if (k(w.end) < k(w.start)) errors.push(`${id}: end date before start date`);
    }
    if (w.start && w.start[0] > new Date().getFullYear()) errors.push(`${id}: date in the future`);
    // Location
    const l = e.where || {};
    if (!l.name || !l.country) errors.push(`${id}: location needs name and country`);
    if (!(l.lat >= -90 && l.lat <= 90 && l.lon >= -180 && l.lon <= 180)) errors.push(`${id}: invalid coordinates`);
    if (!PRECISIONS.includes(l.precision)) errors.push(`${id}: precision must be one of ${PRECISIONS.join(', ')}`);
    if (!/^Q\d+$/.test(l.wikidata || '')) errors.push(`${id}: coordinates need a Wikidata source (where.wikidata)`);
    if (l.place && !placeSlugs.has(l.place)) errors.push(`${id}: unknown place "${l.place}"`);
    // Text and sourcing
    for (const k of ['description', 'context']) if (!Array.isArray(e[k]) || !e[k].length) errors.push(`${id}: missing ${k}`);
    if (!Array.isArray(e.facts) || !e.facts.length) errors.push(`${id}: needs at least one documented fact`);
    if (!Array.isArray(e.uncertain)) errors.push(`${id}: "uncertain" must be an array (may be empty)`);
    checkSources(id, e.sources);
    for (const f of [...(e.facts || []), ...(e.uncertain || [])]) {
      if (!f.text || !Array.isArray(f.s) || !f.s.length) errors.push(`${id}: fact without source reference: ${String(f.text).slice(0, 50)}`);
      for (const n of f.s || []) if (!Number.isInteger(n) || n < 1 || n > (e.sources || []).length) errors.push(`${id}: fact cites missing source [${n}]`);
    }
    for (const r of e.related || []) if (!slugs.has(r)) errors.push(`${id}: related entry "${r}" does not exist`);
    if (!Array.isArray(e.people) || !Array.isArray(e.tags)) errors.push(`${id}: people and tags must be arrays`);
    if (e.category === 'person' && !(e.people || []).length) errors.push(`${id}: person entry needs a name in people`);
    checkImage(id, e.image);
  }
  if (slugs.size !== entries.length) errors.push('duplicate entry slugs');

  for (const p of places) {
    const id = 'place ' + p.slug;
    if (!p.name || !p.country || !p.description) errors.push(`${id}: missing name, country or description`);
    checkSources(id, p.sources);
    checkImage(id, p.image);
    const n = entries.filter((e) => e.where.place === p.slug).length;
    // A place page needs real content; don't publish thin pages.
    if (n < 2) errors.push(`${id}: only ${n} entries — place pages need at least 2`);
  }
  return { entries, places, images, errors, warnings };
}

if (process.argv[1] && /validate\.mjs$/.test(process.argv[1])) {
  const { entries, places, errors, warnings } = validate(resolve(import.meta.dirname, '..'));
  for (const w of warnings) console.warn('warning:', w);
  for (const e of errors) console.error('error:', e);
  const sources = entries.reduce((n, e) => n + e.sources.length, 0);
  console.log(`${entries.length} entries, ${places.length} places, ${sources} source citations, ${errors.length} errors, ${warnings.length} warnings`);
  if (errors.length) process.exit(1);
}
