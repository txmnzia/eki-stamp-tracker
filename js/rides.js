// ── 7b. RIDE SECTIONS ─────────────────────────────────────────────────────
// Paints the saved "ridden stretch" overlays from state.rides, and migrates
// rides saved under pre-disambiguation bare line names.

import { RIDE_OVERLAY } from './config.js';
import { state } from './state.js';
import { ui, linesByName, lineColorMap, rideOverlays, stationByCode,
         shinkansenData } from './registry.js';
import { ptDist } from './geometry.js';
import { buildLineGeometry, buildRideSegments } from './line-geometry.js';
import { scheduleSave } from './gist.js';
import { bringStationsToFront } from './markers.js';

// Rides were historically keyed by the geojson's bare 路線名 (日光線, 本線…).
// Those homonyms are now operator-qualified (JR日光線, 東武日光線…), so saved
// rides under an old bare key are re-keyed to whichever qualified line runs
// nearest the ride's own stations. Exact old→new fan-out generated from the
// relabelling diff; runs once per load (no-op when nothing matches).
const RIDE_NAME_MIGRATION = {
    '京都線': ['近鉄京都線', '阪急京都本線'],
    '北陸線': ['IRいしかわ鉄道線', 'JR北陸本線(米原～敦賀)', 'ハピラインふくい線'],
    '南北線': ['仙台市営地下鉄南北線', '北大阪急行電鉄', '札幌市営地下鉄南北線'],
    '国分寺線': ['西武国分寺線'],
    '城北線': ['伊予鉄道環状線（１系統）', '東海交通事業城北線'],
    '奈良線': ['近鉄奈良線'],
    '山手線': ['JR山手線', '神戸市営地下鉄山手線'],
    '山田線': ['JR山田線', '近鉄山田線'],
    '日光線': ['JR日光線', '東武日光線'],
    '本線': ['JR成田エクスプレス', 'JR成田線', 'JR神戸線(神戸～姫路)', '京急本線', '京成本線',
             '函館市電２系統', '函館市電５系統', '富山地鉄不二越・上滝線', '富山地鉄市内線【１・２系統】',
             '富山地鉄本線', '山陽電鉄本線', '広電１号線(宇品線)', '広電２号線(宮島線)', '相鉄・JR直通線',
             '相鉄本線', '近江鉄道本線', '長崎電軌１系統', '阪神本線', '黒部峡谷鉄道本線'],
    '東西線': ['京都市営地下鉄東西線', '仙台市営地下鉄東西線', '札幌市営地下鉄東西線'],
    '江ノ島線': ['小田急江ノ島線'],
    '甘木線': ['甘木鉄道甘木線', '西鉄甘木線'],
    '田原本線': ['近鉄田原本線'],
    '鉄道線': ['箱根登山鉄道鉄道線', '遠州鉄道鉄道線'],
    '長野線': ['近鉄長野線', '長野電鉄長野線'],
    '関西空港線': ['JR関西空港線', '南海空港線'],
    '高尾線': ['京王高尾線'],
    '鹿島線': ['JR鹿島線'],
};
const migrateRideKeys = () => {
    let changed = false;
    Object.keys(state.rides).forEach(oldName => {
        if (linesByName[oldName] || shinkansenData[oldName]) return;
        const candidates = (RIDE_NAME_MIGRATION[oldName] || []).filter(n => linesByName[n]);
        if (!candidates.length) return;
        // Centroid of the ride's own stations decides which qualified line it was.
        const stCodes = state.rides[oldName].flatMap(c => c.split('|'));
        let lat = 0, lng = 0, n = 0;
        stCodes.forEach(c => { const s = stationByCode[c]; if (s) { lat += s.lat; lng += s.lon; n++; } });
        if (!n) return;
        const ctr = [lat / n, lng / n];
        let best = null, bd = Infinity;
        candidates.forEach(cand => {
            linesByName[cand].forEach(pl => pl.getLatLngs().forEach(ll => {
                const d = ptDist(ctr, [ll.lat, ll.lng]);
                if (d < bd) { bd = d; best = cand; }
            }));
        });
        if (!best || bd > 15000) return;
        state.rides[best] = [...new Set([...(state.rides[best] || []), ...state.rides[oldName]])];
        delete state.rides[oldName];
        changed = true;
    });
    if (changed) scheduleSave();
};

// Redraw the bright "ridden stretch" overlays for one line from state.rides.
// Seeds the corridor from the saved stations' own location so it rebuilds the
// right region (not a far same-name region) after a session load.
export const renderRideOverlays = (name) => {
    if (!ui.linesReady) return;   // building geometry mid-render caches a broken graph
    (rideOverlays[name] || []).forEach(p => p.remove());
    rideOverlays[name] = [];
    const codes = state.rides[name];
    if (!codes || !codes.length || !linesByName[name]) return;

    // Seed = centroid of the saved stations (codes, or codes inside segment keys).
    const stCodes = codes.flatMap(c => c.split('|'));
    let sLat = 0, sLng = 0, n = 0;
    stCodes.forEach(c => { const s = stationByCode[c]; if (s) { sLat += s.lat; sLng += s.lon; n++; } });
    const seed = n ? { lat: sLat / n, lng: sLng / n } : undefined;

    const geom  = buildLineGeometry(name, seed);
    const byCode = {};
    geom.stations.forEach(s => { byCode[s.code] = s; });
    // Render through the SAME segments the picker offers (incl. gap bridges), so
    // anything tickable renders identically — no segment silently dropped.
    const segByKey = new Map(buildRideSegments(geom).map(s => [s.key, s]));
    const color = lineColorMap[name] || '#7eb8f7';
    const keyOf  = (a, b) => [a, b].sort().join('|');
    const drawKey = (k) => {
        const s = segByKey.get(k);
        if (s) rideOverlays[name].push(L.polyline(s.pts, { color, ...RIDE_OVERLAY, renderer: ui.canvasRenderer, interactive: false }).addTo(ui.map));
    };

    if (codes.some(c => c.includes('|'))) {
        // Segment-based: each key is a ridden inter-station segment.
        const ticked = new Set(codes);
        ticked.forEach(drawKey);
        // Fill internal cross-chain gaps for rides saved before gap-bridging
        // existed: between two ridden, ekidata-adjacent stations on different
        // chains, draw the bridge so the old ride is continuous too.
        const ridden = [...new Set(stCodes)].map(c => byCode[c]).filter(Boolean).sort((a, b) => a.idx - b.idx);
        for (let i = 1; i < ridden.length; i++) {
            const p = ridden[i - 1], q = ridden[i];
            if (q.idx !== p.idx + 1 || p.chainIdx === q.chainIdx) continue;
            const k = keyOf(p.code, q.code);
            if (!ticked.has(k)) drawKey(k);
        }
    } else {
        // Legacy station-code rides: colour between consecutive ridden stations.
        const ridden = codes.map(c => byCode[c]).filter(Boolean).sort((a, b) => a.idx - b.idx);
        for (let i = 1; i < ridden.length; i++) {
            if (ridden[i].idx === ridden[i - 1].idx + 1) drawKey(keyOf(ridden[i - 1].code, ridden[i].code));
        }
    }
    bringStationsToFront();   // keep station markers tappable above overlays
};

// Clear and redraw every line's ride overlays (after a session load/import).
// Deferred until every line feature is drawn (onLinesReady re-invokes it) so
// geometry is never built — and cached — against a partial render.
export const renderAllRideOverlays = () => {
    if (!ui.linesReady || !ui.map || !Object.keys(linesByName).length) return;
    migrateRideKeys();
    Object.keys(rideOverlays).forEach(n => { (rideOverlays[n] || []).forEach(p => p.remove()); rideOverlays[n] = []; });
    Object.keys(state.rides).forEach(renderRideOverlays);
};
