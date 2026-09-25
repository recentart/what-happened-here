// Fabrication check for names: every capitalised name or term in an entry's text
// (people, places, organisations, titles) must appear in that entry's cached sources.
// Complements check-claims.mjs, which checks numbers.
//
//   node scripts/check-names.mjs [slug]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '..');
const cacheFile = (url) => join(ROOT, '.cache', 'pages', createHash('sha1').update(url).digest('hex').slice(0, 16) + '.txt');
const only = process.argv[2];

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'").replace(/ß/g, 'ss').replace(/ł/g, 'l');
// Ordinary words that are often capitalised at the start of a sentence or in headings.
const COMMON = new Set(`a an the this that these those it its in on at of for from to by with and or but as after before during when while where
which who what its his her their our we they he she is was were be been there here some many most more each every both one two three four five six seven
eight nine ten first second third last later earlier early late about around over under between into only also although because despite since until
however today now then than such other another all any no not no-one this approximately nearly some several much little built work construction
according historians accounts exact counts figures dates sources scholars details crediting calling although whether how why marker coordinates
estimates participant attendance casualty troop population ancient european british american french german roman greek english italian
spanish portuguese japanese indian mexican egyptian soviet ottoman byzantine christian muslim catholic orthodox norman african asian
january february march april may june july august september october november december sunday monday tuesday wednesday thursday friday saturday
bce ce ad bc c uk us usa ii iii iv xi i driven funded elsewhere inside presidents`.split(/\s+/));

// Reviewed spelling variants: the source uses a different transliteration of the same name.
const VARIANTS = {
  palaiologos: 'palaeologus', // Britannica: Constantine XI Palaeologus
  quranic: 'quaranic', // UNESCO's page spells it "Quaranic"
  kyiv: 'kiev', // World Nuclear Association uses the older spelling
  augustus: 'augusto', // Rome heritage office page is in Italian
  'fire-truck': 'fire truck',
  temples: 'templi', // Italian source: "alle spalle dei templi B e C"
};

function terms(text) {
  const out = new Set();
  // Sequences of capitalised words, e.g. "Pudding Lane", "Gustave Eiffel", "Nika".
  for (const m of text.matchAll(/\b(\p{Lu}[\p{L}’'-]+(?:\s+(?:de|da|di|del|von|van|la|le|of|the)?\s*\p{Lu}[\p{L}’'-]+)*)/gu)) {
    for (const w of m[1].split(/\s+/)) {
      const k = norm(w).replace(/ß/g, 'ss').replace(/[’']s$/, '').replace(/[’']+$/, '').replace(/s'$/, 's').replace(/[^a-z'-]/g, '');
      if (k.length > 2 && !COMMON.has(k)) out.add(k);
    }
  }
  return out;
}

let problems = 0; let checked = 0;
for (const f of readdirSync(join(ROOT, 'data', 'entries'))) {
  const e = JSON.parse(readFileSync(join(ROOT, 'data', 'entries', f), 'utf8'));
  if (only && e.slug !== only) continue;
  const src = norm(e.sources.map((s) => (existsSync(cacheFile(s.url)) ? readFileSync(cacheFile(s.url), 'utf8') : '') + ' ' + s.title + ' ' + s.publisher).join('\n')
    + ' ' + e.where.name + ' ' + e.where.country); // location names are checked against Wikidata separately
  const text = [e.summary, e.when.note || '', ...e.description, ...e.context, ...e.facts.map((x) => x.text), ...e.uncertain.map((x) => x.text), ...(e.people || [])].join('\n');
  const missing = [...terms(text)].filter((t) => { checked++; return !src.includes(t) && !(VARIANTS[t] && src.includes(VARIANTS[t])); });
  if (missing.length) { problems++; console.log(`${e.slug}: ${missing.join(', ')}`); }
}
console.log(`\nChecked ${checked} name words; ${problems} entries have names to review.`);
if (problems) process.exitCode = 1;
