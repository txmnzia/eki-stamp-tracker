// Unit tests for js/geometry.js — the pure geometry layer (no Leaflet, no
// DOM, no app state). Run with:  node --test tests/
//
// These are behavioural anchors for the refactor: small synthetic fixtures
// that pin down the stitching/bridging/projection semantics the ride feature
// depends on. The full-app regression net remains scripts/audit-ride-gaps.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mPerDeg, projToSeg, stitchChains, bridgeChains, describeChain,
  ptDist, snapOnChain, snapToChains, chainProj, sliceVerts, shinkansenSmooth,
  bboxGap, distToBbox, seedBucket,
} from '../js/geometry.js';

// All fixtures sit near Tokyo latitude; [lat, lng] like the app.
const LAT = 35.0;

test('ptDist: ~91 m per 0.001° of longitude at 35°N', () => {
  const d = ptDist([LAT, 139.0], [LAT, 139.001]);
  assert.ok(Math.abs(d - 111320 * Math.cos(LAT * Math.PI / 180) * 0.001) < 0.5, `got ${d}`);
});

test('projToSeg: point on the segment projects with d2≈0 and clamped t', () => {
  const [sx, sy] = mPerDeg(LAT);
  const a = [LAT, 139.0], b = [LAT, 139.01];
  const mid = projToSeg([LAT, 139.005], a, b, sx, sy);
  assert.ok(mid.d2 < 1e-6);
  assert.ok(Math.abs(mid.t - 0.5) < 1e-9);
  // Beyond either end, t clamps to 0/1.
  assert.equal(projToSeg([LAT, 138.9], a, b, sx, sy).t, 0);
  assert.equal(projToSeg([LAT, 139.9], a, b, sx, sy).t, 1);
});

test('stitchChains: joins coincident endpoints, reversing segments as needed', () => {
  const A = [[35.0, 139.00], [35.0, 139.01]];
  const B = [[35.0, 139.02], [35.0, 139.01]];          // reversed continuation of A
  const C = [[36.0, 140.00], [36.0, 140.01]];          // unrelated
  const chains = stitchChains([A, B, C]);
  assert.equal(chains.length, 2);
  const long = chains.find(c => c.length === 3);
  assert.deepEqual(long, [[35.0, 139.00], [35.0, 139.01], [35.0, 139.02]]);
});

test('bridgeChains: merges nearby chain ends, leaves far chains apart', () => {
  const A = [[35.0, 139.00], [35.0, 139.01]];
  const B = [[35.0, 139.012], [35.0, 139.02]];   // ~180 m gap to A's tail
  const C = [[35.5, 139.50], [35.5, 139.51]];    // tens of km away
  const merged = bridgeChains([A, B, C], 850);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(c => c.length === 4).length, 4);   // A+B joined
});

test('describeChain: cumulative arc is monotone and totals the chain length', () => {
  const ch = describeChain([[35.0, 139.00], [35.0, 139.01], [35.0, 139.02]]);
  assert.equal(ch.arc[0], 0);
  assert.ok(ch.arc[1] > 0 && ch.arc[2] > ch.arc[1]);
  const expect = ptDist([35.0, 139.00], [35.0, 139.01]) + ptDist([35.0, 139.01], [35.0, 139.02]);
  assert.ok(Math.abs(ch.arc[2] - expect) < 0.5);
  assert.deepEqual(ch.bbox, [35.0, 35.0, 139.00, 139.02]);
});

test('snapOnChain / snapToChains / chainProj: nearest segment wins', () => {
  const ch1 = describeChain([[35.00, 139.00], [35.00, 139.02]]);
  const ch2 = describeChain([[35.10, 139.00], [35.10, 139.02]]);
  const s = snapToChains([ch1, ch2], 35.09, 139.01);   // closer to ch2
  assert.equal(s.chainIdx, 1);
  const p = chainProj(ch2, s);
  assert.ok(Math.abs(p[0] - 35.10) < 1e-9 && Math.abs(p[1] - 139.01) < 1e-6);
});

test('sliceVerts: interior vertices come back in A→B order (both directions)', () => {
  const ch = describeChain([[35.0, 139.00], [35.0, 139.01], [35.0, 139.02], [35.0, 139.03]]);
  const A = snapOnChain(ch, 35.0, 139.001), B = snapOnChain(ch, 35.0, 139.029);
  assert.deepEqual(sliceVerts(ch, A, B), [[35.0, 139.01], [35.0, 139.02]]);
  assert.deepEqual(sliceVerts(ch, B, A), [[35.0, 139.02], [35.0, 139.01]]);
});

test('shinkansenSmooth: curve passes through every stop at its anchor index', () => {
  const stops = [[35.0, 139.0], [35.2, 139.3], [35.1, 139.6], [35.4, 139.9]];
  const { coords, anchorIdx } = shinkansenSmooth(stops);
  assert.equal(anchorIdx.length, stops.length);
  stops.forEach((p, i) => {
    const c = coords[anchorIdx[i]];
    assert.ok(Math.hypot(c[0] - p[0], c[1] - p[1]) < 1e-9, `stop ${i} not an anchor`);
  });
});

test('bboxGap / distToBbox: zero when overlapping, positive when apart', () => {
  const A = describeChain([[35.0, 139.0], [35.0, 139.1]]);
  const B = describeChain([[35.0, 139.05], [35.0, 139.2]]);   // overlaps A
  const C = describeChain([[36.0, 139.0], [36.0, 139.1]]);    // ~111 km north
  assert.equal(bboxGap(A, B), 0);
  assert.ok(bboxGap(A, C) > 100000);
  assert.equal(distToBbox({ lat: 35.0, lng: 139.05 }, A), 0);
  assert.ok(distToBbox({ lat: 36.0, lng: 139.05 }, A) > 100000);
});

test('seedBucket: 1° buckets, "all" without a seed', () => {
  assert.equal(seedBucket({ lat: 35.4, lng: 139.6 }), '35_140');
  assert.equal(seedBucket(null), 'all');
});
