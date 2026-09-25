# What Happened Here?

Interactive map for exploring documented historical events, places, people, and stories around the world.

**Live site:** https://what-happened-here.freewebtoolss.workers.dev

V1 holds 51 carefully sourced entries across seven categories — historical events, buildings & landmarks, important people, disasters, battles & conflicts, inventions & discoveries, and cultural events — plus place guides for London, Paris, Rome, New York City, Washington D.C., Istanbul and Athens.

## Principles

- **Every entry is sourced.** Each documented fact links to the numbered source that supports it (museums, archives, UNESCO, national park and heritage services, universities, Britannica…).
- **Uncertainty is shown.** Approximate dates are stored as ranges and labelled; disputed points (death tolls, contested dates, alternative sites, questions of credit) go in a separate "Uncertain or debated" section.
- **No invented precision.** If a source gives only a month or a year, the entry does too.
- **Coordinates come from Wikidata**, never typed by hand; each entry cites the Wikidata item used.
- **Images are openly licensed** (public domain, CC0, CC BY, CC BY-SA) from Wikimedia Commons, with author, licence and file link on every page.

## How it works

A static site: no backend, database, accounts, analytics or paid APIs.

```
data/entries/*.json   one file per entry (text, dates, location, sources, image)
data/places.json      place guides (only for places with 2+ entries)
data/images.json      image licence manifest, generated from the Commons API
src/assets/           CSS and browser JavaScript (lib.js holds shared logic)
src/vendor/           MapLibre GL JS 5.24 (BSD-3), vendored — no npm install needed
scripts/build.mjs     static site generator → site/
site/                 build output (not committed); deployed as Cloudflare static assets
```

If the tile server is unreachable, the map falls back to a plain background with all markers and cards still working, and says so. If a Wikimedia image fails, a placeholder links to the file on Commons.

The map uses [MapLibre GL JS](https://maplibre.org) with free vector tiles from [OpenFreeMap](https://openfreemap.org) (OpenStreetMap data) — no API key. Search, category filters and the timeline run entirely in the browser against `/data/entries.json`.

## Commands

Requires Node 20+ (no dependencies).

| Command | What it does |
| --- | --- |
| `npm run build` | Validate data and build the site into `site/` |
| `npm test` | Unit tests for dates, timeline scale, search and filters, plus data validation |
| `npm run validate` | Data checks: sources on every entry, every fact cites a source, valid dates/coordinates, licensed images, no thin place pages |
| `npm run images` | Regenerate `data/images.json` (licence, author, thumbnail) from the Wikimedia Commons API |
| `npm run check:coords` | Confirm every coordinate matches its Wikidata item |
| `npm run check:sources` | Load every cited source page (headless Chrome/Chromium/Edge if installed, otherwise plain HTTP) and confirm that every number **and** every capitalised name in each entry appears in that entry's own sources |
| `npm run dev` | Local preview with `wrangler dev` (runs the build first) |
| `node test/serve.mjs` then `node test/browser.mjs http://127.0.0.1:8788` | End-to-end browser tests, including simulated tile-server and image-host outages (needs Chrome) |
| `node test/site-audit.mjs` | SEO/link audit of the built site |
| `npx wrangler deploy` | Build and deploy to Cloudflare (static-assets Worker, `wrangler.jsonc`) |

## Adding an entry

1. Research it from reliable sources; write original summaries.
2. Find the site's Wikidata item and copy its coordinates: `node scripts/lookup.mjs "Wikipedia title"` prints the QID, coordinates and freely licensed Commons images.
3. Create `data/entries/<slug>.json` following an existing entry. Put disputed points in `uncertain`; cite sources in each fact's `s` array (1-based).
4. `npm run images && npm run validate && npm run check:coords && npm run check:sources && npm test`.

Without a browser, `check:sources` falls back to plain HTTP; sites with bot protection (Britannica, UNESCO) refuse those requests, so install Chrome or set `CHROME_PATH` for full coverage. A failed fetch never overwrites a good cached copy. Genuine spelling variants between an entry and its source (e.g. Kyiv/Kiev) are listed, with the reason, in `scripts/check-names.mjs`.

## Advertising (future)

No ads in V1. The templates mark future slots with `<!-- slot:name -->` comments (below entry content, entry/place sidebars, between home sections) so ads can be added without redesigning pages. They are deliberately kept away from the map.

## Licences

Code: MIT. Entry text: original summaries, CC BY 4.0. Images: licences as listed per image (Wikimedia Commons). Map data © OpenStreetMap contributors; tiles © OpenMapTiles / OpenFreeMap. MapLibre GL JS: BSD-3-Clause.
