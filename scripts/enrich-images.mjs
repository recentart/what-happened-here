// Builds data/images.json from the Wikimedia Commons API: thumbnail URL, author,
// licence and file page for every image named in data/entries and data/places.
// Licence details are copied from Commons, never typed by hand.
//
//   node scripts/enrich-images.mjs
//
// Fails if any image is missing or not under an accepted free licence.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { commons, licenceOk } from './lookup.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const files = new Set();
for (const f of readdirSync(join(ROOT, 'data', 'entries'))) {
  const e = JSON.parse(readFileSync(join(ROOT, 'data', 'entries', f), 'utf8'));
  if (e.image) files.add(e.image.file);
}
for (const p of JSON.parse(readFileSync(join(ROOT, 'data', 'places.json'), 'utf8'))) if (p.image) files.add(p.image.file);

const meta = await commons([...files].map((f) => 'File:' + f), 1280);
const out = {};
const problems = [];
for (const file of [...files].sort()) {
  const m = [...meta.values()].find((v) => v.requested === 'File:' + file || v.file === 'File:' + file.replace(/_/g, ' '));
  if (!m || m.missing) { problems.push(`${file}: not found on Commons`); continue; }
  if (!licenceOk(m.license)) { problems.push(`${file}: licence "${m.license}" not accepted`); continue; }
  // Use the canonical upload host without tracking parameters, and only Wikimedia's
  // standard thumbnail widths (other widths are refused with HTTP 400).
  const src = m.thumb.replace('://thumb.wikimedia.org/', '://upload.wikimedia.org/').split('?')[0];
  const isThumb = /\/\d+px-[^/]+$/.test(src);
  out[file] = {
    page: m.page,
    src, // 1280px wide (or the original if smaller)
    srcSmall: isThumb && m.width > 500 ? src.replace(/\/\d+px-([^/]+)$/, '/500px-$1') : src,
    width: m.width, height: m.height,
    // Commons renders "Unknown author" templates twice when stripped of HTML.
    author: m.artist ? m.artist.replace(/^(.+?)\1$/, '$1') : null,
    credit: m.credit || null,
    license: m.license,
    licenseUrl: m.licenseUrl || null,
  };
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
writeFileSync(join(ROOT, 'data', 'images.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`${Object.keys(out).length} images written to data/images.json`);
