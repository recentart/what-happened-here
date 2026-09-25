// Fabrication check: every number in an entry's text (years, days, counts, measurements)
// must appear somewhere in the text of that entry's own sources, as cached by
// `node scripts/fetch-pages.mjs --sources`. Numbers that can't be found are listed for review.
//
//   node scripts/check-claims.mjs [slug]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '..');
const cacheFile = (url) => join(ROOT, '.cache', 'pages', createHash('sha1').update(url).digest('hex').slice(0, 16) + '.txt');
const only = process.argv[2];

// Numbers written as words in sources ("seven prisoners", "four days").
const WORDS = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 12: 'twelve', 20: 'twenty' };
const SEPARATOR = /(\d)[,   ](\d{3})(?!\d)/g;

function numbersIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?!\w)/g)) {
    const n = m[1].replace(/,/g, '');
    if (n.length === 1) continue; // single digits are too ambiguous to check automatically
    out.add(n);
  }
  return out;
}

function sourceText(urls) {
  let text = urls.map((u) => (existsSync(cacheFile(u)) ? readFileSync(cacheFile(u), 'utf8') : '')).join('\n');
  // Strip thousands separators ("2,500,000", "60 000") until nothing changes.
  for (let prev; prev !== text;) { prev = text; text = text.replace(SEPARATOR, '$1$2'); }
  return text;
}

function found(n, text) {
  if (new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?!\\d)`).test(text)) return true;
  return !!(WORDS[n] && new RegExp(`\\b${WORDS[n]}\\b`, 'i').test(text));
}

let problems = 0; let checked = 0; let missingCache = 0;
for (const f of readdirSync(join(ROOT, 'data', 'entries'))) {
  const e = JSON.parse(readFileSync(join(ROOT, 'data', 'entries', f), 'utf8'));
  if (only && e.slug !== only) continue;
  const urls = e.sources.map((s) => s.url);
  missingCache += urls.filter((u) => !existsSync(cacheFile(u))).length;
  const src = sourceText(urls);
  const text = [e.title, e.summary, e.when.label, e.when.note || '', ...e.description, ...e.context,
    ...e.facts.map((x) => x.text), ...e.uncertain.map((x) => x.text)].join('\n');
  const missing = [...numbersIn(text)].filter((n) => { checked++; return !found(n, src); });
  if (missing.length) { problems++; console.log(`${e.slug}: not found in sources -> ${missing.join(', ')}`); }
}
console.log(`\nChecked ${checked} numbers across all entries; ${problems} entries have numbers to review.${missingCache ? ` (${missingCache} source pages not cached: run fetch-pages --sources)` : ''}`);
if (problems) process.exitCode = 1;
