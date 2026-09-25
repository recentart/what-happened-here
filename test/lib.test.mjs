import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  parseYear, formatYear, overlaps, dateKey, yearToPos, posToYear, TIMELINE_STOPS,
  buildIndex, search, filterEntries, distanceKm,
} from '../src/assets/js/lib.js';
import { validate } from '../scripts/validate.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const entries = readdirSync(join(ROOT, 'data/entries')).map((f) => JSON.parse(readFileSync(join(ROOT, 'data/entries', f), 'utf8')));
const places = JSON.parse(readFileSync(join(ROOT, 'data/places.json'), 'utf8'));
const index = buildIndex(entries, places);

test('parseYear understands common year formats', () => {
  assert.equal(parseYear('1789'), 1789);
  assert.equal(parseYear('44 BC'), -44);
  assert.equal(parseYear('44 BCE'), -44);
  assert.equal(parseYear('-44'), -44);
  assert.equal(parseYear('AD 79'), 79);
  assert.equal(parseYear('79 CE'), 79);
  assert.equal(parseYear('c. 1450'), 1450);
  assert.equal(parseYear('3000 bce'), -3000);
  assert.equal(parseYear('0'), null, 'there is no year zero');
  assert.equal(parseYear('abc'), null);
  assert.equal(parseYear(''), null);
});

test('formatYear round-trips through parseYear', () => {
  for (const y of [-3000, -44, 1, 79, 999, 1066, 2019]) assert.equal(parseYear(formatYear(y)), y);
  assert.equal(formatYear(-44), '44 BCE');
  assert.equal(formatYear(79), '79 CE');
  assert.equal(formatYear(1789), '1789');
});

test('overlaps treats date ranges inclusively', () => {
  const fire = { start: [1666, 9, 2], end: [1666, 9, 6] };
  assert.ok(overlaps(fire, 1666, 1666));
  assert.ok(overlaps(fire, 1600, 1700));
  assert.ok(!overlaps(fire, 1667, 1800));
  const giza = { start: [-2575], end: [-2465] };
  assert.ok(overlaps(giza, -2500, -2500), 'a year inside a range matches');
  assert.ok(!overlaps(giza, -2400, 0));
});

test('dateKey orders BCE and CE dates chronologically', () => {
  const keys = [[-3000], [-44, 3, 15], [-44, 12, 1], [79, 8, 24], [1066, 10, 14], [1066, 12]].map(dateKey);
  assert.deepEqual([...keys].sort((a, b) => a - b), keys);
});

test('timeline scale is monotonic and invertible at the stops', () => {
  let prev = -1;
  for (let y = -3000; y <= 2026; y += 7) { const p = yearToPos(y); assert.ok(p >= prev); prev = p; }
  for (const s of TIMELINE_STOPS) assert.equal(posToYear(yearToPos(s)), s);
  assert.equal(posToYear(0), -3000);
  assert.notEqual(posToYear(yearToPos(1)), 0, 'never produces year zero');
});

test('search finds cities, events, people and landmarks', () => {
  const top = (q) => search(index, q).map((r) => r.doc.slug);
  assert.equal(top('paris')[0], 'paris', 'city place guide ranks first');
  assert.ok(top('Paris').includes('eiffel-tower'));
  assert.ok(top('bastille').includes('storming-of-the-bastille'));
  assert.ok(top('marie curie').includes('curie-discovery-of-radium'));
  assert.ok(top('eiffel')[0] === 'eiffel-tower');
  assert.ok(top('Tenochtitlán').includes('fall-of-tenochtitlan'), 'diacritics are ignored');
  assert.ok(top('earthquake').length >= 2);
  assert.deepEqual(top('xyzzy nonexistent'), []);
  assert.deepEqual(top('   '), []);
});

test('filterEntries combines search, categories and years', () => {
  const all = filterEntries(entries, index, {});
  assert.equal(all.length, entries.length);
  const battles = filterEntries(entries, index, { cats: new Set(['battle']) });
  assert.ok(battles.length > 0 && battles.every((e) => e.category === 'battle'));
  const c19 = filterEntries(entries, index, { from: 1800, to: 1899 });
  assert.ok(c19.every((e) => e.when.start[0] <= 1899 && (e.when.end || e.when.start)[0] >= 1800));
  assert.equal(filterEntries(entries, index, { q: 'london', cats: new Set(['battle']) }).length, 0);
});

test('distanceKm is roughly right (London–Paris ≈ 344 km)', () => {
  const d = distanceKm({ lat: 51.5072, lon: -0.1276 }, { lat: 48.8567, lon: 2.3522 });
  assert.ok(d > 330 && d < 360, String(d));
});

test('all data passes validation', () => {
  const { errors } = validate(ROOT);
  assert.deepEqual(errors, []);
});

test('every entry has sources and every fact cites one', () => {
  for (const e of entries) {
    assert.ok(e.sources.length >= 1, e.slug);
    for (const f of [...e.facts, ...e.uncertain]) assert.ok(f.s.length >= 1, `${e.slug}: ${f.text}`);
  }
});

