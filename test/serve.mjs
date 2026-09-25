// Minimal local server for site/ that mimics Cloudflare static assets:
// clean URLs (/event/x -> event/x.html), index.html, and 404.html for misses.
//   node test/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'site');
const PORT = +process.argv[2] || 8788;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };

async function file(p) { try { return (await stat(p)).isFile() ? p : null; } catch { return null; } }

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.includes('..')) { res.writeHead(400).end(); return; }
  const base = join(ROOT, path);
  const found = (await file(base)) || (await file(base + '.html')) || (await file(join(base, 'index.html')));
  const target = found || join(ROOT, '404.html');
  res.writeHead(found ? 200 : 404, { 'Content-Type': TYPES[extname(target)] || 'application/octet-stream' });
  res.end(await readFile(target));
}).listen(PORT, '127.0.0.1', () => console.log(`Serving site/ on http://127.0.0.1:${PORT}`));
