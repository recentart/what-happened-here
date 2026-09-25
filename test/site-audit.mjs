// Static audit of the built site/: SEO basics, headings, alt text and internal links.
//   node test/site-audit.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const SITE = resolve(import.meta.dirname, '..', 'site');
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') && files.push(p); } })(SITE);

const problems = [];
const titles = new Map(); const descs = new Map();
const exists = (path) => {
  const clean = path.split(/[?#]/)[0];
  if (clean === '/') return true;
  const base = join(SITE, clean);
  return existsSync(base) && statSync(base).isFile() || existsSync(base + '.html') || existsSync(join(base, 'index.html'));
};
for (const f of files) {
  const rel = '/' + relative(SITE, f).replace(/\\/g, '/');
  const html = readFileSync(f, 'utf8');
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  if (!title) problems.push(`${rel}: no title`);
  if (!desc || desc.length < 50) problems.push(`${rel}: missing/short description`);
  if (!/<link rel="canonical" href="https:\/\//.test(html)) problems.push(`${rel}: no canonical`);
  if (!/property="og:title"/.test(html)) problems.push(`${rel}: no Open Graph tags`);
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) problems.push(`${rel}: should have exactly one h1`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt="[^"]+"/.test(m[0])) problems.push(`${rel}: image without alt text`);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(m[1]); } catch { problems.push(`${rel}: invalid JSON-LD`); } }
  for (const m of html.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)) if (!exists(m[1])) problems.push(`${rel}: broken internal link ${m[1]}`);
  if (!rel.includes('404')) {
    if (titles.has(title)) problems.push(`${rel}: duplicate title with ${titles.get(title)}`); else titles.set(title, rel);
    if (descs.has(desc)) problems.push(`${rel}: duplicate description with ${descs.get(desc)}`); else descs.set(desc, rel);
  }
}
const sitemap = readFileSync(join(SITE, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
for (const l of locs) if (!exists(l)) problems.push(`sitemap: ${l} does not exist`);
if (!/Sitemap: https:\/\//.test(readFileSync(join(SITE, 'robots.txt'), 'utf8'))) problems.push('robots.txt has no sitemap line');

console.log(`${files.length} HTML files, ${locs.length} sitemap URLs, ${problems.length} problems`);
problems.slice(0, 40).forEach((p) => console.log('  ' + p));
if (problems.length) process.exitCode = 1;
