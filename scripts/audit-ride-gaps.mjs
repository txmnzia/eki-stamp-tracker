#!/usr/bin/env node
/**
 * audit-ride-gaps.mjs — find ride-overlay discontinuities across EVERY line.
 *
 * A line's track is stitched from the bundled geojson into one or more "chains".
 * A ride is coloured by slicing the chain between consecutive ridden stations, so
 * a gap appears wherever two ekidata-ADJACENT stations end up on different chains
 * and are too far apart to bridge (> RIDE_GAP_BRIDGE_M). This script drives the
 * real app (so it uses the exact same buildLineGeometry / buildRideSegments — no
 * reimplementation that can drift) and reports every such gap, classified as:
 *   - HOLE         : no geojson track near the straight line  → a straight bridge
 *                    is the only/honest option (and looks fine).
 *   - SPLIT-TRACK  : real track exists between them but is split into chains → the
 *                    straight bridge diverges from the visible base line by `div`.
 *
 * Use it to (a) see all gaps at once instead of finding them one screenshot at a
 * time, (b) pick RIDE_GAP_BRIDGE_M from data, (c) gate CI (exits 1 if gaps remain
 * above --max). Anomalies (tens of km — branch termini threaded into the order, or
 * duplicate line names spanning regions) surface as the largest HOLEs.
 *
 * Usage:
 *   # serve the repo somewhere first, e.g.  python3 -m http.server 8097
 *   BASE_URL=http://127.0.0.1:8097 node scripts/audit-ride-gaps.mjs [--max=8000]
 *
 * Env:
 *   BASE_URL      app origin (default http://127.0.0.1:8097)
 *   PW_MODULE     playwright module specifier (default "playwright")
 *   PW_CHROMIUM   chromium executablePath (default: playwright's bundled one)
 */
const arg = (k, d) => { const a = process.argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8097';
const MAX = Number(arg('max', '0')) || 0;   // 0 = use the app's RIDE_GAP_BRIDGE_M

const pw = await import(process.env.PW_MODULE || 'playwright');
const chromium = pw.chromium || pw.default?.chromium;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, headless: true });
const page = await browser.newPage();
await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(
  () => typeof linesByName !== 'undefined' && Object.keys(linesByName).length > 100 &&
        typeof buildLineGeometry === 'function' && typeof buildRideSegments === 'function',
  null, { timeout: 60000 });
await page.waitForTimeout(2500);

const report = await page.evaluate((forcedMax) => {
  const cap = forcedMax || (typeof RIDE_GAP_BRIDGE_M !== 'undefined' ? RIDE_GAP_BRIDGE_M : 8000);
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
  return { cap, totalLines: lines.length, linesWithGaps: out.length, totalGaps, lines: out };
}, MAX);

console.log(`ride-gap audit @ cap ${report.cap}m — ${report.totalLines} lines, ${report.linesWithGaps} with gaps, ${report.totalGaps} gaps total\n`);
for (const l of report.lines) {
  console.log(l.name);
  for (const g of l.gaps) console.log(`  ${g.kind.padEnd(11)} ${String(g.m).padStart(6)}m  ${g.pair}${g.kind === 'SPLIT-TRACK' ? `  (diverges ~${g.div}m)` : ''}`);
}
await browser.close();
process.exit(report.totalGaps > 0 ? 1 : 0);
