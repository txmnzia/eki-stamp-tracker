// ── 7c. RIDE EDIT MODE (select stretches directly on the map) ──────────────
// The active edit session lives on ui.rideEdit so line rendering can
// suppress hover/highlight while editing without importing this module.

import { IS_TOUCH, LINE_EDIT_DIM, RIDE_OVERLAY } from './config.js';
import { state } from './state.js';
import { ui, linesByName, allLineSegs, lineColorMap, rideOverlays, markers, plainMarkers,
         esc, orderLineNames } from './registry.js';
import { buildLineGeometry, buildRideSegments } from './line-geometry.js';
import { scheduleSave } from './gist.js';
import { showToast } from './notify.js';
import { resetAllLines } from './lines.js';
import { renderRideOverlays } from './rides.js';
import { dedupeKey } from './markers.js';

// ── 7c. RIDE EDIT MODE (select stretches directly on the map) ──────────────
// Branched/looping lines can't be shown as one list, so rides are selected on
// the map itself: each inter-station segment is individually paintable. Tap a
// segment to toggle it; drag along the line to paint a stretch. A drag that
// starts ON the line paints (map pan locked for that gesture); a drag that
// starts off the line pans normally. Selection is stored as segment keys.


const segStyle = (color, on) => on
    ? { color, weight: 6, opacity: 0.95, lineCap: 'round', renderer: ui.canvasRenderer, interactive: false }
    : { color, weight: 3, opacity: 0.4,  lineCap: 'round', renderer: ui.canvasRenderer, interactive: false };

// Initial selection from saved state (segment keys, or legacy station codes).
const initialRideSelection = (name, segs) => {
    const sel = new Set();
    const saved = state.rides[name] || [];
    if (saved.some(c => c.includes('|'))) {
        const keys = new Set(saved);
        segs.forEach(s => { if (keys.has(s.key)) sel.add(s.key); });
    } else {
        const ridden = new Set(saved);
        segs.forEach(s => { if (ridden.has(s.a.code) && ridden.has(s.b.code)) sel.add(s.key); });
    }
    return sel;
};

const paintSeg = (seg) => seg.pl.setStyle(segStyle(ui.rideEdit.color, ui.rideEdit.selected.has(seg.key)));

const refreshRideEditCache = () => {
    if (!ui.rideEdit) return;
    ui.rideEdit.segs.forEach(seg => { seg._cp = seg.pts.map(p => ui.map.latLngToContainerPoint([p[0], p[1]])); });
};

const ptSegDist = (px, py, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - a.x) * dx + (py - a.y) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
};

const rideHitTest = (x, y) => {
    let best = null, bd = IS_TOUCH ? 24 : 14;
    for (const seg of ui.rideEdit.segs) {
        const cp = seg._cp;
        for (let i = 1; i < cp.length; i++) {
            const d = ptSegDist(x, y, cp[i - 1], cp[i]);
            if (d < bd) { bd = d; best = seg; }
        }
    }
    return best;
};

const applyRidePaint = (seg) => {
    if (!seg) return;
    if (ui.rideEdit.mode === 'add') ui.rideEdit.selected.add(seg.key); else ui.rideEdit.selected.delete(seg.key);
    paintSeg(seg);
};

// Station label shown on hover while editing a ride — so lines whose stations
// have no stamp marker are still identifiable. Shows the segment under the
// cursor as "A – B" (the two stations it would toggle).
const rideNodeName = (s) => (state.lang === 'en' ? (s.name_en || s.name_kanji) : (s.name_kanji || s.name_en)) || s.code;
const hideRideHover = () => { if (ui.rideEdit && ui.rideEdit.tipShown) { ui.rideEdit.tip.remove(); ui.rideEdit.tipShown = false; } };
const updateRideHover = (x, y) => {
    if (!ui.rideEdit) return;
    const seg = rideHitTest(x, y);
    if (!seg) { hideRideHover(); return; }
    if (!ui.rideEdit.tip) ui.rideEdit.tip = L.tooltip({ direction: 'top', offset: [0, -6], className: 'line-tooltip', permanent: true, interactive: false });
    ui.rideEdit.tip.setLatLng(ui.map.containerPointToLatLng(L.point(x, y)))
                .setContent(`${esc(rideNodeName(seg.a))} – ${esc(rideNodeName(seg.b))}`);
    if (!ui.rideEdit.tipShown) { ui.rideEdit.tip.addTo(ui.map); ui.rideEdit.tipShown = true; }
};

export const enterRideEditMode = (name) => {
    if (!ui.linesReady) { showToast('Lines are still loading — try again in a moment.'); return; }
    if (ui.rideEdit) exitRideEditMode(false);
    const geom = buildLineGeometry(name, ui.linePopupSeed);
    const unsupported = name.includes('新幹線') && !shinkansenData[name];
    if (unsupported || geom.stations.length < 2) {
        showToast(unsupported ? 'Ride logging isn’t available for this Shinkansen line yet.'
                              : 'No track data to log a ride on this line yet.', 3000);
        return;
    }
    ui.map.closePopup();
    const color = lineColorMap[name] || '#7eb8f7';
    const segs  = buildRideSegments(geom);
    (rideOverlays[name] || []).forEach(p => p.remove()); rideOverlays[name] = [];   // hide existing overlay while editing

    const collectedKeys = new Set();
    markers.forEach(m => { if (m._isCollected && m._stationData) collectedKeys.add(dedupeKey(m._stationData)); });

    const layer = L.layerGroup().addTo(ui.map);
    segs.forEach(seg => { seg.pl = L.polyline(seg.pts, segStyle(color, false)).addTo(layer); });
    geom.stations.forEach(s => {
        const coll = collectedKeys.has(dedupeKey(s));
        L.circleMarker([s.lat, s.lon], { radius: 4, weight: 2, color: coll ? '#f7c948' : '#ffffff',
            fillColor: coll ? '#f7c948' : color, fillOpacity: 1, interactive: false, renderer: ui.canvasRenderer }).addTo(layer);
    });

    ui.rideEdit = { name, color, geom, segs, selected: initialRideSelection(name, segs), layer, dragging: false, mode: 'add' };
    segs.forEach(paintSeg);

    // Focus mode: fade every other line right down and fade other lines' ride
    // overlays, so only the line being edited stands out. Hide this line's own
    // faint base (the bright editable segments replace it). Also make EVERY line
    // non-interactive so hovering another line shows no tooltip/highlight — focus
    // stays fully on the line being edited (restored on exit).
    const own = new Set(linesByName[name] || []);
    allLineSegs.forEach(p => {
        if (!own.has(p)) p.setStyle(LINE_EDIT_DIM); else p.setStyle({ opacity: 0 });
        p.closeTooltip();
        p.options.interactive = false;
    });
    Object.entries(rideOverlays).forEach(([ln, arr]) => { if (ln !== name) arr.forEach(pl => pl.setStyle({ opacity: 0.1 })); });
    // Station markers sit right on the line; make them non-interactive too so a tap
    // paints the ride segment instead of opening a station popup (restored on exit).
    [...markers, ...plainMarkers].forEach(m => { m.options.interactive = false; });

    // Stay on the user's current view — don't fit the whole line (they're usually
    // already looking at the stretch they want to edit).
    ui.map.on('moveend zoomend', refreshRideEditCache);
    refreshRideEditCache();

    const { primary, secondary } = orderLineNames(name);
    document.getElementById('ride-edit-title').textContent = primary;
    document.getElementById('ride-edit-sub').textContent   = secondary || '';
    document.getElementById('ride-edit-bar').classList.remove('hidden');
    ui.map.getContainer().style.cursor = 'crosshair';
};

const exitRideEditMode = (save) => {
    if (!ui.rideEdit) return;
    const { name, selected, layer } = ui.rideEdit;
    hideRideHover();
    ui.map.off('moveend zoomend', refreshRideEditCache);
    layer.remove();
    ui.map.dragging.enable();
    const c = ui.map.getContainer(); c.style.cursor = ''; c.style.touchAction = '';
    document.getElementById('ride-edit-bar').classList.add('hidden');
    ui.rideEdit = null;
    // Restore focus: re-enable interactivity, un-fade all lines and other overlays.
    allLineSegs.forEach(p => { p.options.interactive = true; });
    [...markers, ...plainMarkers].forEach(m => { m.options.interactive = true; });
    resetAllLines();
    Object.values(rideOverlays).forEach(arr => arr.forEach(pl => pl.setStyle({ opacity: RIDE_OVERLAY.opacity })));
    if (save) {
        const keys = [...selected];
        if (keys.length) state.rides[name] = keys; else delete state.rides[name];
        scheduleSave();
        showToast(keys.length ? 'Ride saved' : 'Ride cleared');
    }
    renderRideOverlays(name);
};

export const setupRideEdit = () => {
    const container = ui.map.getContainer();
    const cancel = () => exitRideEditMode(false);
    document.getElementById('ride-edit-save').addEventListener('click', () => exitRideEditMode(true));
    document.getElementById('ride-edit-cancel').addEventListener('click', cancel);
    document.addEventListener('keydown', (e) => {
        // Don't hijack Escape while the user is typing in an input elsewhere.
        if (e.key === 'Escape' && ui.rideEdit && !e.target.closest('input, textarea')) cancel();
    });

    const xy = (e) => { const r = container.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    container.addEventListener('pointerdown', (e) => {
        if (!ui.rideEdit) return;
        const [x, y] = xy(e);
        const seg = rideHitTest(x, y);
        if (!seg) return;                       // off the line → let the map pan
        e.preventDefault();
        hideRideHover();                        // don't keep the label up while painting
        ui.map.dragging.disable();         // lock pan for this paint gesture
        container.style.touchAction = 'none';
        try { container.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        ui.rideEdit.dragging = true;
        ui.rideEdit.mode = ui.rideEdit.selected.has(seg.key) ? 'remove' : 'add';
        applyRidePaint(seg);
    });
    container.addEventListener('pointermove', (e) => {
        if (!ui.rideEdit) return;
        const [x, y] = xy(e);
        if (ui.rideEdit.dragging) { applyRidePaint(rideHitTest(x, y)); return; }
        if (!IS_TOUCH) updateRideHover(x, y);   // hover label (desktop only; touch has no hover)
    });
    container.addEventListener('pointerleave', hideRideHover);
    const end = (e) => {
        if (!ui.rideEdit || !ui.rideEdit.dragging) return;
        ui.rideEdit.dragging = false;
        ui.map.dragging.enable();
        container.style.touchAction = '';
        try { container.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
};
