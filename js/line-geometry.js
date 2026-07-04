// ── 7g. LINE GEOMETRY ─────────────────────────────────────────────────────
// App-level geometry: builds a clicked line's corridor (chains + ordered
// stations), the ride segments between them, and the curated Shinkansen
// paths. Pure algorithms live in geometry.js; this layer binds them to the
// app's data registries.

import { RIDE_SNAP_M, RIDE_INCLUDE_M, RIDE_BBOX_PAD, RIDE_BRIDGE_M, RIDE_STITCH_M,
         RIDE_ROUTE_MAX_M, SHK_BRIDGE_M, SHK_SNAP_M } from './config.js';
import { mPerDeg, projToSeg, stitchChains, seedBucket, ptDist, bridgeChains, describeChain,
         bboxGap, distToBbox, shinkansenSmooth, snapOnChain, snapToChains, chainProj,
         sliceVerts } from './geometry.js';
import { linesByName, lineGroups, allStations, lineGeomCache, shinkansenData,
         shinkansenGeo } from './registry.js';

let shinkansenPool = null; // all Shinkansen fragments stitched together — used to fill a line's gaps
                           // with the physically-shared track stored under a sibling line's name

// All Shinkansen track stitched into one set of chains (built once, cached). A
// line's own gaps are filled from here because shared corridors (e.g. Tokyo–
// Takasaki) are stored under whichever Shinkansen the geojson happened to label.
const buildShinkansenPool = () => {
    if (shinkansenPool) return shinkansenPool;
    const all = [];
    Object.values(shinkansenGeo).forEach(arr => arr.forEach(s => { if (s.length >= 2) all.push(s); }));
    return (shinkansenPool = bridgeChains(stitchChains(all).filter(c => c.length >= 2), SHK_BRIDGE_M).map(describeChain));
};
// Real track between two stops borrowed from the shared pool: both must land on
// the SAME pooled chain within SHK_SNAP_M, and the sliced length must be close to
// the straight chord (0.7–1.7×) so a stitched branch can never add a detour.
const borrowSlice = (pool, a, b) => {
    const chord = ptDist(a, b), snap2 = SHK_SNAP_M * SHK_SNAP_M;
    let best = null;
    for (const ch of pool) {
        const A = snapOnChain(ch, a[0], a[1]); if (A.d2 > snap2) continue;
        const B = snapOnChain(ch, b[0], b[1]); if (B.d2 > snap2) continue;
        const slen = Math.abs(A.pos - B.pos);
        if (slen < 0.7 * chord || slen > 1.7 * chord) continue;
        const cost = A.d2 + B.d2;
        if (!best || cost < best.cost) best = { cost, ch, A, B };
    }
    return best ? { verts: sliceVerts(best.ch, best.A, best.B), endA: chainProj(best.ch, best.A), endB: chainProj(best.ch, best.B) } : null;
};

// Build a Shinkansen's drawn path by FOLLOWING the bundled real track geometry,
// not straight (or smoothed) hops between stops. The line's own track is stitched
// into ordered chain(s) and each stop snapped onto it; the path slices the real
// vertices between consecutive on-track stops. Where the line has no own track
// (shared Tokyo corridors stored under a sibling line, tunnels), it borrows the
// physically-shared track from the pooled Shinkansen geometry; only spans no
// Shinkansen covers (e.g. the newer Kanazawa–Tsuruga extension) stay straight.
// Returns dense coords + the index of each stop within them (anchorIdx), so the
// same path drives both the drawn line and the ride geometry. Cached on the
// line's info. (Lines with no usable geometry fall back to a smooth curve.)
export const shinkansenPath = (name) => {
    const info = shinkansenData[name];
    if (info._path) return info._path;
    const pts = info.stations.map(s => [s.lat, s.lon]);

    const segs = (shinkansenGeo[name] || []).filter(s => s.length >= 2);
    if (segs.length < 1) return (info._path = shinkansenSmooth(pts));

    const chains = bridgeChains(stitchChains(segs).filter(c => c.length >= 2), SHK_BRIDGE_M).map(describeChain);
    if (!chains.length) return (info._path = shinkansenSmooth(pts));

    const snap2   = SHK_SNAP_M * SHK_SNAP_M;
    const snaps   = pts.map(p => snapToChains(chains, p[0], p[1]));
    const onTrack = snaps.map(s => s && s.d2 <= snap2);
    // If almost nothing snaps, the geometry is unusable for this line — smooth.
    if (onTrack.filter(Boolean).length < 2) return (info._path = shinkansenSmooth(pts));

    // The pool is only needed when this line has gaps; build it lazily.
    const pool = onTrack.every(Boolean) ? null : buildShinkansenPool();
    const poolSnap = pool ? pts.map(p => snapToChains(pool, p[0], p[1])) : [];

    // Anchor a stop on its own track, else on the shared pool, else its raw coord.
    const anchorPt = (i) => onTrack[i] ? chainProj(chains[snaps[i].chainIdx], snaps[i])
                          : (pool && poolSnap[i] && poolSnap[i].d2 <= snap2) ? chainProj(pool[poolSnap[i].chainIdx], poolSnap[i])
                          : pts[i].slice();

    const coords = [], anchorIdx = [];
    for (let i = 0; i < pts.length; i++) {
        anchorIdx.push(coords.length);
        coords.push(anchorPt(i));
        if (i === pts.length - 1) break;
        // 1) Own track when both stops sit on the same own chain.
        if (onTrack[i] && onTrack[i + 1] && snaps[i].chainIdx === snaps[i + 1].chainIdx) {
            for (const v of sliceVerts(chains[snaps[i].chainIdx], snaps[i], snaps[i + 1])) coords.push(v);
        // 2) Otherwise borrow the shared real track from the pool (guarded).
        } else if (pool) {
            const b = borrowSlice(pool, pts[i], pts[i + 1]);
            if (b) for (const v of b.verts) coords.push(v);
            // 3) else: straight connector (the next anchor closes the gap).
        }
    }
    return (info._path = { coords, anchorIdx });
};
/**
 * Build (and cache) the ride geometry for the corridor of a line nearest `seed`:
 * ordered stitched chains (far same-name regions dropped) and the corridor's
 * stations snapped onto them in along-track order.
 * @param {string} name  line's 路線名
 * @param {{lat:number,lng:number}} [seed]  a point on the clicked corridor
 * @returns {{chains:Array, stations:Array}}
 */
export const buildLineGeometry = (name, seed) => {
    // Curated Shinkansen: the line IS its ordered stops, so the geometry is the
    // smoothed (Catmull-Rom) curve through them and the station list is exact —
    // no corridor/merge. Stops are anchor vertices in the smoothed path, so the
    // ride overlays/segments follow the same smooth curve as the drawn line.
    if (shinkansenData[name]) {
        if (lineGeomCache[name]) return lineGeomCache[name];
        const stops = shinkansenData[name].stations;
        const path  = shinkansenPath(name);
        const ch    = describeChain(path.coords);
        const lastV = path.coords.length - 1;
        const stations = stops.map((s, i) => {
            const v = path.anchorIdx[i];
            return { code: s.code, name_kanji: s.name_kanji, name_en: s.name_en, lat: s.lat, lon: s.lon,
                chainIdx: 0, segIdx: v >= lastV ? lastV - 1 : v, t: v >= lastV ? 1 : 0, pos: ch.arc[v], idx: i };
        });
        return (lineGeomCache[name] = { chains: [ch], allChains: [ch], stations });
    }

    const cacheKey = name + '|' + seedBucket(seed);
    if (lineGeomCache[cacheKey]) return lineGeomCache[cacheKey];

    const polys = linesByName[name] || [];
    const segs  = polys.map(pl => pl.getLatLngs().map(ll => [ll.lat, ll.lng]));
    let raw = stitchChains(segs).filter(c => c.length >= 2);
    raw = bridgeChains(raw, RIDE_STITCH_M);                  // close small gaps in a continuous line
    let all = raw.map(describeChain);
    all.sort((a, b) => b.coords.length - a.coords.length);

    // Keep only the corridor connected to the seed: start from the chain nearest
    // the seed (or the longest chain if no seed) and transitively add chains
    // whose bbox is within RIDE_BRIDGE_M of the kept set. This drops far-away
    // segments that merely share the line name.
    let chains = all;
    if (all.length > 1) {
        let seedIdx = 0;
        if (seed) { let bd = Infinity; all.forEach((c, i) => { const d = distToBbox(seed, c); if (d < bd) { bd = d; seedIdx = i; } }); }
        const keep = new Set([seedIdx]);
        for (let grew = true; grew; ) {
            grew = false;
            for (let i = 0; i < all.length; i++) {
                if (keep.has(i)) continue;
                for (const k of keep) {
                    if (bboxGap(all[i], all[k]) <= RIDE_BRIDGE_M) { keep.add(i); grew = true; break; }
                }
            }
        }
        chains = [...keep].sort((a, b) => a - b).map(i => all[i]);
        chains.sort((a, b) => b.coords.length - a.coords.length);
    }

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    chains.forEach(ch => {
        if (ch.bbox[0] < minLat) minLat = ch.bbox[0]; if (ch.bbox[1] > maxLat) maxLat = ch.bbox[1];
        if (ch.bbox[2] < minLng) minLng = ch.bbox[2]; if (ch.bbox[3] > maxLng) maxLng = ch.bbox[3];
    });

    const snapMax2 = RIDE_SNAP_M ** 2;
    const incMax2  = RIDE_INCLUDE_M ** 2;
    const inBox = (lat, lon) => lat >= minLat - RIDE_BBOX_PAD && lat <= maxLat + RIDE_BBOX_PAD &&
                                lon >= minLng - RIDE_BBOX_PAD && lon <= maxLng + RIDE_BBOX_PAD;

    // Snap a coordinate onto the nearest kept chain (returns the projection + d²).
    const snap = (lat, lon) => {
        const p = [lat, lon];
        let bd2 = Infinity, bc = -1, bseg = 0, bt = 0;
        for (let ci = 0; ci < chains.length; ci++) {
            const { coords, sx, sy } = chains[ci];
            for (let i = 1; i < coords.length; i++) {
                const { d2, t } = projToSeg(p, coords[i - 1], coords[i], sx, sy);
                if (d2 < bd2) { bd2 = d2; bc = ci; bseg = i - 1; bt = t; }
            }
        }
        if (bc < 0) return null;
        const ch = chains[bc];
        return { chainIdx: bc, segIdx: bseg, t: bt, pos: ch.arc[bseg] + bt * (ch.arc[bseg + 1] - ch.arc[bseg]), d2: bd2 };
    };

    // STATION LIST: ekidata's ordered per-line groups are the source of truth for
    // which stations & their order. But one geojson line is often served by several
    // ekidata lines (rapid + local + through), and any single group skips the
    // others' stops — e.g. 中央本線 jumps Shinjuku→Kichijoji, skipping Nakano/
    // Kōenji/…. So: take the richest on-corridor group as a BACKBONE, then merge in
    // every other corridor line's extra stops, each inserted into the backbone edge
    // it best fits. Result = the COMPLETE line, correctly ordered, no foreign stops.
    const md   = (a, b) => { const [sx, sy] = mPerDeg((a.lat + b.lat) / 2); return Math.hypot((a.lon - b.lon) * sx, (a.lat - b.lat) * sy); };
    // Dedupe key: normalised name + ~5km grid (ヶ/ケ variants and the small
    // platform-coordinate differences between a station's rapid & local rows
    // collapse to one entry).
    const dkey = (s) => (s.name_kanji || s.code).replace(/ヶ/g, 'ケ') + '|' + Math.round(s.lat * 20) + '|' + Math.round(s.lon * 20);

    // Score every group by how many of its stations sit ON this corridor.
    const scored = lineGroups.map(g => {
        let hits = 0;
        const snaps = g.stations.map(s => {
            if (!inBox(s.lat, s.lon)) return null;
            const sn = snap(s.lat, s.lon);
            if (!sn) return null;
            if (sn.d2 <= snapMax2) hits++;
            return sn.d2 <= incMax2 ? sn : null;
        });
        return { g, hits, snaps };
    }).filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits);

    let stations;
    if (scored.length && scored[0].hits >= 2) {
        const mk = (s, sn) => ({ code: s.code, name_kanji: s.name_kanji, name_en: s.name_en, lat: s.lat, lon: s.lon, ...sn });

        // Backbone = richest group's on-corridor run, in ekidata order.
        const backbone = [];
        scored[0].g.stations.forEach((s, k) => { if (scored[0].snaps[k]) backbone.push(mk(s, scored[0].snaps[k])); });
        const present = new Set(backbone.map(dkey));

        // Extra stops from the other corridor lines (need a tight on-corridor snap
        // and a real presence, so perpendicular crossings aren't pulled in).
        const extras = [];
        for (let i = 1; i < scored.length; i++) {
            if (scored[i].hits < 3) continue;
            scored[i].g.stations.forEach((s, k) => {
                const sn = scored[i].snaps[k];
                if (!sn || sn.d2 > snapMax2) return;
                const rec = mk(s, sn), key = dkey(rec);
                if (present.has(key)) return;
                present.add(key);
                extras.push(rec);
            });
        }

        // Place each extra into the backbone edge with the least detour.
        const byEdge = {};
        for (const X of extras) {
            let best = Infinity, edge = backbone.length;
            for (let j = 0; j < backbone.length - 1; j++) {
                const detour = md(backbone[j], X) + md(X, backbone[j + 1]) - md(backbone[j], backbone[j + 1]);
                if (detour < best) { best = detour; edge = j + 1; }
            }
            const front = md(X, backbone[0]), back = md(X, backbone[backbone.length - 1]);
            if (front < best && front <= back) { edge = 0; }
            else if (back < best) { edge = backbone.length; }
            (byEdge[edge] = byEdge[edge] || []).push(X);
        }
        const merged = [];
        for (let j = 0; j <= backbone.length; j++) {
            if (byEdge[j]) {
                // Stops before the first backbone station are ordered farthest-first;
                // every other edge is ordered by distance from its start station.
                if (j === 0) byEdge[j].sort((a, b) => md(backbone[0], b) - md(backbone[0], a));
                else { const ref = backbone[j - 1]; byEdge[j].sort((a, b) => md(ref, a) - md(ref, b)); }
                merged.push(...byEdge[j]);
            }
            if (j < backbone.length) merged.push(backbone[j]);
        }
        stations = merged.map((s, i) => (s.idx = i, s));
    } else {
        // Fallback (line not in ekidata groups): proximity snap, deduped by name.
        const best = {};
        for (const st of allStations) {
            if (!inBox(st.lat, st.lon)) continue;
            const sn = snap(st.lat, st.lon);
            if (!sn || sn.d2 > snapMax2) continue;
            const key = dkey(st);
            if (!best[key] || sn.d2 < best[key].d2) best[key] = { ...st, ...sn };
        }
        stations = Object.values(best)
            .sort((a, b) => a.chainIdx - b.chainIdx || a.pos - b.pos)
            .map((s, i) => (s.idx = i, s));
    }

    // allChains = every stitched chain of the line (before the corridor filter
    // drops far same-name regions). The ride graph routes on THIS so it matches
    // the base map line's connectivity exactly — the corridor filter only limits
    // which STATIONS are listed, never which track a ride can follow. (Far
    // duplicate-name regions stay separate components, so routing can't jump to
    // them; RIDE_ROUTE_MAX_M caps any stray long route.)
    return (lineGeomCache[cacheKey] = { chains, allChains: all, stations });
};

// Exact projected [lat,lng] of a snapped station on its chain.
export const snappedPoint = (geom, rec) => {
    const c = geom.chains[rec.chainIdx].coords;
    const a = c[rec.segIdx], b = c[rec.segIdx + 1];
    return [a[0] + (b[0] - a[0]) * rec.t, a[1] + (b[1] - a[1]) * rec.t];
};

// Build (and cache) an undirected graph of ALL the corridor's track vertices.
// The base map draws every geojson segment, so the track is fully connected
// even where stitchChains split it into separate chains (junctions, T-joins).
// Keying vertices by rounded coordinate reconnects those shared points, so a
// ride can follow the real drawn track rather than break at a chain boundary.
const buildLineGraph = (geom) => {
    if (geom._graph) return geom._graph;
    const key = (p) => p[0].toFixed(5) + ',' + p[1].toFixed(5);
    const adj = new Map(), pt = new Map();
    const add = (p, q) => {
        const kp = key(p), kq = key(q); if (kp === kq) return;
        pt.set(kp, p); pt.set(kq, q);
        const w = ptDist(p, q);
        (adj.get(kp) || adj.set(kp, []).get(kp)).push({ k: kq, w });
        (adj.get(kq) || adj.set(kq, []).get(kq)).push({ k: kp, w });
    };
    (geom.allChains || geom.chains).forEach(ch => { const c = ch.coords; for (let i = 1; i < c.length; i++) add(c[i - 1], c[i]); });
    return (geom._graph = { adj, pt, key });
};

// The real track sub-path between two ridden stations: the SHORTEST path along
// the connected track graph (so it follows the actual drawn line, across chain
// boundaries, never a straight chord). Returns null when the graph has no path
// between them (a genuine hole) or the route is implausibly long (a data
// anomaly, e.g. a branch terminus mis-ordered as adjacent). Endpoints are the
// exact projected station positions.
export const trackBetween = (geom, a, b) => {
    const Pa = snappedPoint(geom, a), Pb = snappedPoint(geom, b);
    if (a.chainIdx === b.chainIdx && a.segIdx === b.segIdx) return [Pa, Pb];
    // Same chain: slice the chain's own vertices directly (no route cap). The
    // graph route below is only needed to cross chain boundaries; capping it at
    // RIDE_ROUTE_MAX_M would wrongly drop long same-chain hops (e.g. Shinkansen
    // stations 50–60 km apart on one continuous chain), leaving those segments
    // unbuilt and unclickable in edit mode even though the base line is drawn.
    if (a.chainIdx === b.chainIdx) {
        return [Pa, ...sliceVerts(geom.chains[a.chainIdx], a, b), Pb];
    }
    const G = buildLineGraph(geom);
    const ca = geom.chains[a.chainIdx].coords, cb = geom.chains[b.chainIdx].coords;
    const exit = new Map();   // b's two bounding vertices, with the cost to reach Pb
    exit.set(G.key(cb[b.segIdx]),     ptDist(Pb, cb[b.segIdx]));
    exit.set(G.key(cb[b.segIdx + 1]), ptDist(Pb, cb[b.segIdx + 1]));

    const dist = new Map(), prev = new Map(), heap = [];
    const push = (d, k) => { heap.push([d, k]); let i = heap.length - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop();
        if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2*i+1, r = 2*i+2, s = i;
            if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
            if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
            if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } } return top; };
    const seed = (k, d) => { if (G.pt.has(k) && d < (dist.get(k) ?? Infinity)) { dist.set(k, d); prev.set(k, null); push(d, k); } };
    seed(G.key(ca[a.segIdx]),     ptDist(Pa, ca[a.segIdx]));
    seed(G.key(ca[a.segIdx + 1]), ptDist(Pa, ca[a.segIdx + 1]));

    let bestK = null, bestTotal = Infinity;
    while (heap.length) {
        const [d, k] = pop();
        if (d > dist.get(k)) continue;
        if (d >= bestTotal || d > RIDE_ROUTE_MAX_M) break;     // no unpopped node can do better
        if (exit.has(k)) { const t = d + exit.get(k); if (t < bestTotal) { bestTotal = t; bestK = k; } }
        for (const { k: nk, w } of G.adj.get(k)) { const nd = d + w; if (nd < (dist.get(nk) ?? Infinity)) { dist.set(nk, nd); prev.set(nk, k); push(nd, nk); } }
    }
    if (bestK === null || bestTotal > RIDE_ROUTE_MAX_M) return null;
    const mid = []; for (let k = bestK; k != null; k = prev.get(k)) mid.push(G.pt.get(k));
    mid.reverse();
    return [Pa, ...mid, Pb];
};
// Selectable inter-station segments, one per consecutive pair in ekidata order.
// Each follows the REAL track (shortest path on the connected track graph), so it
// crosses chain boundaries exactly the way the base map line does. We deliberately
// do NOT invent a straight connector when the graph can't link two stations: if
// the bundled geojson has no track there, the base line is gapped too, so the ride
// shows the same gap — both views stay faithful to the one source. (A missing
// segment is therefore a genuine data hole, or a bare-name corridor like "本線"
// that merges unrelated railways — see scripts/audit-ride-gaps.mjs.)
export const buildRideSegments = (geom) => {
    const list = [...geom.stations].sort((a, b) => a.idx - b.idx);
    const segs = [];
    for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        const pts = trackBetween(geom, a, b);
        if (pts) segs.push({ a, b, key: [a.code, b.code].sort().join('|'), pts });
    }
    return segs;
};
