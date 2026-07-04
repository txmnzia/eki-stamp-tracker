// ── 7p. PURE GEOMETRY ─────────────────────────────────────────────────────
// Coordinate/track geometry with NO imports, no Leaflet, no DOM, no app
// state — everything here runs under plain `node --test`
// (tests/geometry.test.mjs). Keep it that way.

// Equirectangular metres-per-degree at a latitude (good enough at line scale).
export const mPerDeg = (lat) => [111320 * Math.cos(lat * Math.PI / 180), 110540];

// Distance² (in metres²) from P to segment A–B, plus the clamped projection
// parameter t. Planar approximation scaled around the segment's latitude.
export const projToSeg = (p, a, b, sx, sy) => {
    const ax = a[1] * sx, ay = a[0] * sy, bx = b[1] * sx, by = b[0] * sy;
    const px = p[1] * sx, py = p[0] * sy;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * dx, cy = ay + t * dy;
    return { d2: (px - cx) ** 2 + (py - cy) ** 2, t };
};

// Stitch many (unordered) [lat,lng] segments into ordered chains by matching
// coincident endpoints. Most lines form one chain; branched/disjoint lines
// yield several (handled as straight-hop fallbacks downstream).
export const stitchChains = (segs) => {
    const key = (pt) => pt[0].toFixed(5) + ',' + pt[1].toFixed(5);
    const ep = {};
    segs.forEach((s, i) => {
        if (s.length < 2) return;
        (ep[key(s[0])]   = ep[key(s[0])]   || []).push([i, 0]);
        (ep[key(s.at(-1))] = ep[key(s.at(-1))] || []).push([i, 1]);
    });
    const used = new Array(segs.length).fill(false);
    const chains = [];
    for (let start = 0; start < segs.length; start++) {
        if (used[start] || segs[start].length < 2) continue;
        used[start] = true;
        let chain = segs[start].slice();
        for (let grow = true; grow; ) {                       // extend tail
            grow = false;
            for (const [j, end] of (ep[key(chain.at(-1))] || [])) {
                if (used[j]) continue;
                const add = end === 0 ? segs[j] : segs[j].slice().reverse();
                chain = chain.concat(add.slice(1)); used[j] = true; grow = true; break;
            }
        }
        for (let grow = true; grow; ) {                       // extend head
            grow = false;
            for (const [j, end] of (ep[key(chain[0])] || [])) {
                if (used[j]) continue;
                const add = end === 0 ? segs[j].slice().reverse() : segs[j];
                chain = add.slice(0, -1).concat(chain); used[j] = true; grow = true; break;
            }
        }
        chains.push(chain);
    }
    return chains;
};

// 1° cache bucket so the Tokyo and Osaka 山手線 don't share a cache entry.
export const seedBucket = (seed) => seed ? Math.round(seed.lat) + '_' + Math.round(seed.lng) : 'all';

export const ptDist = (a, b) => { const [sx, sy] = mPerDeg((a[0] + b[0]) / 2); return Math.hypot((a[1] - b[1]) * sx, (a[0] - b[0]) * sy); };

// Join a line's OWN fragmented chains across small data gaps (≤ maxGap), so a
// continuous line that the source data split into pieces becomes one path. Only
// ever connects ends that are already within maxGap — it does NOT bridge the
// far same-name regions (those are 100s of km apart and dropped by the corridor
// filter anyway). Greedily merges the globally-nearest endpoint pair each round.
export const bridgeChains = (chains, maxGap) => {
    chains = chains.map(c => c.slice());
    for (let merging = true; merging && chains.length > 1; ) {
        merging = false;
        let bi = -1, bj = -1, mode = '', bd = maxGap;
        for (let i = 0; i < chains.length; i++) {
            for (let j = i + 1; j < chains.length; j++) {
                const A = chains[i], B = chains[j];
                const cand = [['th', ptDist(A[A.length - 1], B[0])], ['ht', ptDist(A[0], B[B.length - 1])],
                              ['tt', ptDist(A[A.length - 1], B[B.length - 1])], ['hh', ptDist(A[0], B[0])]];
                for (const [m, d] of cand) if (d < bd) { bd = d; bi = i; bj = j; mode = m; }
            }
        }
        if (bi < 0) break;
        const A = chains[bi], B = chains[bj];
        const merged = mode === 'th' ? A.concat(B)
                     : mode === 'ht' ? B.concat(A)
                     : mode === 'tt' ? A.concat(B.slice().reverse())
                     :                 A.slice().reverse().concat(B);   // hh
        chains.splice(bj, 1); chains.splice(bi, 1, merged); merging = true;
    }
    return chains;
};

// Build a chain descriptor (coords + cumulative arc + scale + bbox).
export const describeChain = (coords) => {
    const mid = coords[Math.floor(coords.length / 2)];
    const [sx, sy] = mPerDeg(mid[0]);
    const arc = [0];
    let mnLat = 90, mxLat = -90, mnLng = 180, mxLng = -180;
    const acc = (p) => { if (p[0] < mnLat) mnLat = p[0]; if (p[0] > mxLat) mxLat = p[0]; if (p[1] < mnLng) mnLng = p[1]; if (p[1] > mxLng) mxLng = p[1]; };
    acc(coords[0]);
    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1], b = coords[i];
        arc.push(arc[i - 1] + Math.hypot((b[1] - a[1]) * sx, (b[0] - a[0]) * sy));
        acc(b);
    }
    return { coords, arc, sx, sy, bbox: [mnLat, mxLat, mnLng, mxLng] };
};

// Gap (metres) between two chain bboxes (0 if they overlap).
export const bboxGap = (A, B) => {
    const [aLat, sy] = mPerDeg((A.bbox[0] + A.bbox[1]) / 2);
    const dLat = Math.max(0, A.bbox[0] - B.bbox[1], B.bbox[0] - A.bbox[1]) * 110540;
    const dLng = Math.max(0, A.bbox[2] - B.bbox[3], B.bbox[2] - A.bbox[3]) * aLat;
    return Math.hypot(dLat, dLng);
};

export const distToBbox = (seed, ch) => {
    const [sx, sy] = mPerDeg(seed.lat);
    const dLat = Math.max(0, ch.bbox[0] - seed.lat, seed.lat - ch.bbox[1]) * 110540;
    const dLng = Math.max(0, ch.bbox[2] - seed.lng, seed.lng - ch.bbox[3]) * sx;
    return Math.hypot(dLat, dLng);
};
// Smooth a Shinkansen's stop sequence into a curved path via centripetal
// Catmull-Rom (passes through every stop, rounds the corners, no overshoot).
// Only used as a fallback when the bundled track geometry is missing.
export const shinkansenSmooth = (pts) => {
    const K = 16;                                   // points generated per inter-stop span
    const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    const coords = [], anchorIdx = [];
    const d = (a, b) => Math.sqrt(Math.hypot(a[0] - b[0], a[1] - b[1])) || 1e-6;   // centripetal knot spacing
    for (let i = 0; i < pts.length - 1; i++) {
        anchorIdx.push(coords.length);
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
        const lerp = (ta, tb, pa, pb, t) => { const f = (t - ta) / (tb - ta); return [pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f]; };
        for (let j = 0; j < K; j++) {
            const t = t1 + (t2 - t1) * (j / K);
            const A1 = lerp(t0, t1, p0, p1, t), A2 = lerp(t1, t2, p1, p2, t), A3 = lerp(t2, t3, p2, p3, t);
            const B1 = lerp(t0, t2, A1, A2, t), B2 = lerp(t1, t3, A2, A3, t);
            coords.push(lerp(t1, t2, B1, B2, t));
        }
    }
    anchorIdx.push(coords.length);
    coords.push(pts[pts.length - 1].slice());
    return { coords, anchorIdx };
};

// Snap a point onto ONE described chain (nearest projection + d²).
export const snapOnChain = (ch, lat, lon) => {
    const p = [lat, lon], { coords, sx, sy } = ch;
    let bd2 = Infinity, bseg = 0, bt = 0;
    for (let i = 1; i < coords.length; i++) {
        const { d2, t } = projToSeg(p, coords[i - 1], coords[i], sx, sy);
        if (d2 < bd2) { bd2 = d2; bseg = i - 1; bt = t; }
    }
    return { segIdx: bseg, t: bt, pos: ch.arc[bseg] + bt * (ch.arc[bseg + 1] - ch.arc[bseg]), d2: bd2 };
};
// Snap onto a SET of chains; returns the best with its chain index.
export const snapToChains = (chains, lat, lon) => {
    let best = null;
    for (let ci = 0; ci < chains.length; ci++) {
        const s = snapOnChain(chains[ci], lat, lon);
        if (!best || s.d2 < best.d2) best = { ...s, chainIdx: ci };
    }
    return best;
};
export const chainProj = (ch, s) => { const c = ch.coords, a = c[s.segIdx], b = c[s.segIdx + 1];
                               return [a[0] + (b[0] - a[0]) * s.t, a[1] + (b[1] - a[1]) * s.t]; };
// Interior vertices of `ch` strictly between two snapped points, in A→B order.
export const sliceVerts = (ch, A, B) => {
    const fwd = A.pos <= B.pos, lo = fwd ? A : B, hi = fwd ? B : A, verts = [];
    for (let k = lo.segIdx + 1; k <= hi.segIdx; k++) verts.push(ch.coords[k].slice());
    if (!fwd) verts.reverse();
    return verts;
};
