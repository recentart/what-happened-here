// Confirms every entry's and place's coordinates match the Wikidata item it cites (P625),
// so no coordinate is typed from memory.
//   node scripts/check-coords.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { wikidata } from './lookup.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const items = [
  ...readdirSync(join(ROOT, 'data/entries')).map((f) => JSON.parse(readFileSync(join(ROOT, 'data/entries', f), 'utf8')))
    .map((e) => ({ id: e.slug, qid: e.where.wikidata, lat: e.where.lat, lon: e.where.lon })),
  ...JSON.parse(readFileSync(join(ROOT, 'data/places.json'), 'utf8')).map((p) => ({ id: 'place ' + p.slug, qid: p.wikidata, lat: p.lat, lon: p.lon })),
];
const wd = await wikidata([...new Set(items.map((i) => i.qid))]);
let bad = 0;
for (const i of items) {
  const w = wd.get(i.qid);
  const d = w && w.lat != null ? Math.max(Math.abs(w.lat - i.lat), Math.abs(w.lon - i.lon)) : Infinity;
  if (d > 0.001) { bad++; console.log(`${i.id}: ${i.lat},${i.lon} vs Wikidata ${i.qid} (${w?.label}) ${w?.lat},${w?.lon}`); }
}
console.log(`${items.length} locations checked against Wikidata, ${bad} mismatches`);
if (bad) process.exitCode = 1;
