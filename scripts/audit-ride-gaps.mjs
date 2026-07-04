#!/usr/bin/env node
/**
 * audit-ride-gaps.mjs — find ride-overlay discontinuities across EVERY line.
 *
 * A ride is coloured by following the connected track graph between consecutive
 * stations (the same track the base map line draws). A gap therefore appears only
 * where the geojson genuinely can't connect two ekidata-ADJACENT stations — the
 * base line is gapped there too. This script drives the real app (so it uses the
 * exact same buildLineGeometry / buildRideSegments — no reimplementation that can
 * drift) and reports every such gap, classified as:
 *   - HOLE         : no geojson track near the straight line (the base line is
 *                    gapped here too — a genuine data hole).
 *   - SPLIT-TRACK  : track exists nearby but the graph route was too long / absent
 *                    (a route over RIDE_ROUTE_MAX_M, i.e. a data anomaly).
 *
 * Use it to (a) see all gaps at once instead of one screenshot at a time, (b) gate
 * CI (exits 1 if any gap remains). The largest gaps are data anomalies — branch
 * termini threaded into the station order, or bare/duplicate line names ("本線")
 * that merge unrelated railways.
 *
 * Usage:
 *   # serve the repo somewhere first, e.g.  python3 -m http.server 8097
 *   BASE_URL=http://127.0.0.1:8097 node scripts/audit-ride-gaps.mjs
 *
 * Env:
 *   BASE_URL      app origin (default http://127.0.0.1:8097)
 *   PW_MODULE     playwright module specifier (default "playwright")
 *   PW_CHROMIUM   chromium executablePath (default: playwright's bundled one)
 *   CDN_LOCAL     dir with leaflet.js/leaflet.css — serve Leaflet from there
 *                 instead of unpkg (for sandboxes/CI without CDN access; get the
 *                 files from the npm "leaflet" package's dist/). Map tiles and
 *                 fonts are stubbed out in this mode (geometry doesn't need them).
 */
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8097';

const pw = await import(process.env.PW_MODULE || 'playwright');
const chromium = pw.chromium || pw.default?.chromium;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, headless: true });
const page = await browser.newPage();
if (process.env.CDN_LOCAL) {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  await page.route('https://unpkg.com/**', (route) => {
    const url = route.request().url();
    const file = url.endsWith('.css') ? 'leaflet.css' : url.endsWith('.js') ? 'leaflet.js' : null;
    if (!file) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200,
      contentType: file.endsWith('.css') ? 'text/css' : 'application/javascript',
      body: readFileSync(join(process.env.CDN_LOCAL, file)) });
  });
  await page.route(/https:\/\/(fonts\.(googleapis|gstatic)\.com|[a-d]\.basemaps\.cartocdn\.com)\/.*/,
    (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
}
await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
// The app is ES modules; its internals are exposed to tooling through the
// window.__eki hook (set in js/main.js — the public contract for this script).
await page.waitForFunction(
  () => window.__eki && typeof __eki.buildLineGeometry === 'function' &&
        typeof __eki.buildRideSegments === 'function' && Array.isArray(__eki.allLineSegs),
  null, { timeout: 60000 });
// IMPORTANT: line features render batched over many frames. Building geometry before
// rendering finishes caches an INCOMPLETE graph (false gaps). Wait until the polyline
// count stops growing, then settle.
await page.waitForFunction(() => {
  window.__n = window.__n || { last: -1, stable: 0 };
  const n = __eki.allLineSegs.length;
  window.__n.stable = (n === window.__n.last) ? window.__n.stable + 1 : 0;
  window.__n.last = n;
  return window.__n.stable >= 5;
}, null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(500);

const report = await page.evaluate(() => {
  const { linesByName, buildLineGeometry, buildRideSegments } = window.__eki;
  const md = (a, b) => { const sx = 111320 * Math.cos((a[0] + b[0]) / 2 * Math.PI / 180), sy = 110540;
                         return Math.hypot((a[1] - b[1]) * sx, (a[0] - b[0]) * sy); };
  const lines = Object.keys(linesByName);
  const out = []; let totalGaps = 0;
  for (const name of lines) {
    // seed each line at the centroid of its own drawn track (its corridor)
    let sLat = 0, sLng = 0, nc = 0;
    (linesByName[name] || []).forEach(pl => pl.getLatLngs().forEach(ll => { sLat += ll.lat; sLng += ll.lng; nc++; }));
    if (!nc) continue;
    const verts = []; (linesByName[name] || []).forEach(pl => pl.getLatLngs().forEach(ll => verts.push([ll.lat, ll.lng])));
    let geom; try { geom = buildLineGeometry(name, { lat: sLat / nc, lng: sLng / nc }); } catch { continue; }
    if (!geom || geom.stations.length < 2) continue;
    const segKeys = new Set(buildRideSegments(geom).map(s => s.key));
    const byIdx = [...geom.stations].sort((a, b) => a.idx - b.idx);
    const gaps = [];
    for (let i = 1; i < byIdx.length; i++) {
      const a = byIdx[i - 1], b = byIdx[i];
      if (segKeys.has([a.code, b.code].sort().join('|'))) continue;   // connectable (segment or bridge)
      if (a.chainIdx === b.chainIdx) continue;                        // same chain: covered by chain track
      const gap = md([a.lat, a.lon], [b.lat, b.lon]);
      // classify: nearest base-track vertex to the straight midpoints
      let div = 1e12;
      for (let t = 0.2; t <= 0.8; t += 0.2) {
        const p = [a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t];
        let near = 1e12; for (const q of verts) { const d = md(p, q); if (d < near) near = d; }
        if (near < div) div = near;
      }
      gaps.push({ pair: `${a.name_en || a.name_kanji}→${b.name_en || b.name_kanji}`,
                  m: Math.round(gap), kind: div > 800 ? 'HOLE' : 'SPLIT-TRACK', div: Math.round(div) });
    }
    if (gaps.length) { totalGaps += gaps.length; out.push({ name, gaps }); }
  }
  out.sort((x, y) => Math.max(...y.gaps.map(g => g.m)) - Math.max(...x.gaps.map(g => g.m)));
  return { totalLines: lines.length, linesWithGaps: out.length, totalGaps, lines: out };
});

console.log(`ride-gap audit — ${report.totalLines} lines, ${report.linesWithGaps} with gaps, ${report.totalGaps} gaps total\n`);
for (const l of report.lines) {
  console.log(l.name);
  for (const g of l.gaps) console.log(`  ${g.kind.padEnd(11)} ${String(g.m).padStart(6)}m  ${g.pair}${g.kind === 'SPLIT-TRACK' ? `  (diverges ~${g.div}m)` : ''}`);
}
await browser.close();
// MAX_GAPS = accepted baseline of known-genuine data holes (see README).
// CI fails only when NEW gaps appear beyond that baseline.
const MAX_GAPS = Number(process.env.MAX_GAPS || 0);
process.exit(report.totalGaps > MAX_GAPS ? 1 : 0);
