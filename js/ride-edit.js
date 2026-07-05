// ── 7c. RIDE EDIT MODE (paint ridden stretches directly on the map) ─────────
// The active edit session lives on ui.rideEdit so line rendering can react to
// it (activate a hovered line, suppress the line popup) without importing this
// module.
//
// GLOBAL edit mode (#18): entering it from any one line's "Edit ride" button
// unlocks EVERY line for painting — you no longer have to re-enter once per line
// just because the rails are split under several official names. Only the lines
// you actually touch are built (581 lines is far too many to build up-front), so
// hovering/tapping a line lazily builds its segments and makes it the active
// paint target. The base map + station dots are dimmed and the lines brought
// forward as the edit-mode indicator; a single discreet "Close" button saves and
// exits (#19). Station hover still shows a read-only name popup (#17), rendered
// by markers.js off the ui.rideEdit flag.

import { IS_TOUCH, LINE_EDIT_SHOW } from './config.js';
import { state } from './state.js';
import { ui, allLineSegs, lineColorMap, rideOverlays } from './registry.js';
import { buildLineGeometry, buildRideSegments } from './line-geometry.js';
import { scheduleSave } from './gist.js';
import { showToast } from './notify.js';
import { resetAllLines } from './lines.js';
import { renderRideOverlays } from './rides.js';
import { bringStationsToFront } from './markers.js';

const segStyle = (color, on) => on
    ? { color, weight: 6, opacity: 0.95, lineCap: 'round', renderer: ui.canvasRenderer, interactive: false }
    : { color, weight: 3, opacity: 0.45, lineCap: 'round', renderer: ui.canvasRenderer, interactive: false };

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

const paintSeg = (entry, seg) => seg.pl.setStyle(segStyle(entry.color, entry.selected.has(seg.key)));

// Cache each segment's screen-space points for cheap hit-testing; refreshed on
// pan/zoom for every line that's been built so far.
const refreshEntryCache = (entry) => {
    entry.segs.forEach(seg => { seg._cp = seg.pts.map(p => ui.map.latLngToContainerPoint([p[0], p[1]])); });
};
const refreshAllCaches = () => { if (ui.rideEdit) ui.rideEdit.built.forEach(e => e && refreshEntryCache(e)); };

const ptSegDist = (px, py, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - a.x) * dx + (py - a.y) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
};

// Hit-test the ACTIVE line's segments only (the one currently hovered/tapped).
const rideHitTest = (x, y) => {
    const R = ui.rideEdit;
    if (!R || !R.active) return null;
    const entry = R.built.get(R.active);
    if (!entry) return null;
    let best = null, bd = IS_TOUCH ? 24 : 14;
    for (const seg of entry.segs) {
        const cp = seg._cp;
        if (!cp) continue;
        for (let i = 1; i < cp.length; i++) {
            const d = ptSegDist(x, y, cp[i - 1], cp[i]);
            if (d < bd) { bd = d; best = seg; }
        }
    }
    return best ? { entry, seg: best } : null;
};

const applyRidePaint = (hit) => {
    if (!hit) return;
    const { entry, seg } = hit;
    if (ui.rideEdit.mode === 'add') entry.selected.add(seg.key); else entry.selected.delete(seg.key);
    ui.rideEdit.dirty = true;
    paintSeg(entry, seg);
};

// Lazily build a line's editable segments the first time it's touched. Returns
// the entry, or null if the line has no rideable track (unsupported Shinkansen,
// bare-name corridor, genuine data hole). The result — including null — is
// cached so a barren line isn't retried on every hover.
const ensureBuilt = (name, seed) => {
    const R = ui.rideEdit;
    if (R.built.has(name)) return R.built.get(name);
    let entry = null;
    try {
        const geom = buildLineGeometry(name, seed);
        const segs = buildRideSegments(geom);
        if (segs.length) {
            const color = lineColorMap[name] || '#7eb8f7';
            const selected = initialRideSelection(name, segs);
            const layer = L.layerGroup().addTo(ui.map);
            segs.forEach(seg => { seg.pl = L.polyline(seg.pts, segStyle(color, selected.has(seg.key))).addTo(layer); });
            (rideOverlays[name] || []).forEach(p => p.remove());   // hide saved overlay; the editable segments replace it
            entry = { name, geom, segs, layer, color, selected };
            refreshEntryCache(entry);
        }
    } catch (err) {
        console.error('ride-edit build', name, err);
    }
    R.built.set(name, entry);
    if (entry) bringStationsToFront();   // keep the (dimmed) station markers hoverable above the new overlay
    return entry;
};

// Called from lines.js when a line is hovered (desktop) or tapped (touch) while
// editing — that line becomes the active paint target.
const activateLine = (name, latlng) => {
    if (!ui.rideEdit) return;
    const seed = latlng ? { lat: latlng.lat, lng: latlng.lng } : undefined;
    const entry = ensureBuilt(name, seed);
    if (entry) ui.rideEdit.active = name;   // barren line: keep the previous active target
};

export const enterRideEditMode = (name) => {
    if (!ui.linesReady) { showToast('Lines are still loading — try again in a moment.'); return; }
    if (ui.rideEdit) return;   // already editing
    ui.map.closePopup();
    ui.rideEdit = { built: new Map(), active: null, dragging: false, mode: 'add', dirty: false };

    // Edit-mode look: bring every line forward and fade the base MAP tiles so the
    // network stands out. Station dots and saved-ride overlays stay fully visible —
    // the user needs to keep seeing their collected stamps and existing rides while
    // editing. Lines stay interactive, so hovering one shows its name tooltip and
    // makes it the active paint target.
    allLineSegs.forEach(p => { p.closeTooltip(); p.setStyle(LINE_EDIT_SHOW); });
    ui.map.getContainer().classList.add('ride-editing');

    // Pre-activate the clicked line, seeded from where its popup was opened.
    const seed = ui.linePopupSeed ? { lat: ui.linePopupSeed.lat, lng: ui.linePopupSeed.lng } : undefined;
    const entry = ensureBuilt(name, seed);
    ui.rideEdit.active = entry ? name : null;

    // Stay on the user's current view (they're usually already looking at the
    // stretch they want). Keep every built line's hit-test cache fresh on pan/zoom.
    ui.map.on('moveend zoomend', refreshAllCaches);

    document.getElementById('ride-edit-close').classList.remove('hidden');
    // The Close button takes over the bottom-centre slot — hide the stats bar
    // so the two never overlap (docs/AUDIT.md F-3).
    document.getElementById('stats-bar')?.classList.add('hidden');
    ui.map.getContainer().style.cursor = 'crosshair';
    showToast('Tap or drag along any line to mark the stretch you rode. Tap Close when done.', 3500);
};

// Close = save & switch back to normal mode (#19). There's no separate cancel:
// painting is fully reversible on the map, so the only exit persists the result.
const exitRideEditMode = () => {
    if (!ui.rideEdit) return;
    const R = ui.rideEdit;
    const changed = R.dirty;
    ui.map.off('moveend zoomend', refreshAllCaches);

    const built = [...R.built.keys()];
    R.built.forEach((entry, name) => {
        if (!entry) return;
        entry.layer.remove();
        if (changed) {
            const keys = [...entry.selected];
            if (keys.length) state.rides[name] = keys; else delete state.rides[name];
        }
    });

    ui.map.dragging.enable();
    const c = ui.map.getContainer();
    c.style.cursor = ''; c.style.touchAction = ''; c.classList.remove('ride-editing');
    document.getElementById('ride-edit-close').classList.add('hidden');
    document.getElementById('stats-bar')?.classList.remove('hidden');
    ui.rideEdit = null;

    // Restore the normal look, then redraw the saved-ride overlays for every line
    // we touched (their overlays were removed while their segments were editable).
    resetAllLines();
    built.forEach(renderRideOverlays);

    if (changed) { scheduleSave(); showToast('Ride changes saved'); }
};

export const setupRideEdit = () => {
    ui.rideEditActivate = activateLine;   // lines.js calls this on hover/tap while editing
    const container = ui.map.getContainer();
    document.getElementById('ride-edit-close').addEventListener('click', () => exitRideEditMode());
    document.addEventListener('keydown', (e) => {
        // Don't hijack Escape while the user is typing in an input elsewhere.
        if (e.key === 'Escape' && ui.rideEdit && !e.target.closest('input, textarea')) exitRideEditMode();
    });

    const xy = (e) => { const r = container.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    container.addEventListener('pointerdown', (e) => {
        if (!ui.rideEdit) return;
        const [x, y] = xy(e);
        const hit = rideHitTest(x, y);
        if (!hit) return;                       // not on the active line → let the map pan / marker handle it
        e.preventDefault();
        ui.map.closePopup();                    // don't leave a station popup up while painting
        ui.map.dragging.disable();              // lock pan for this paint gesture
        container.style.touchAction = 'none';
        try { container.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        ui.rideEdit.dragging = true;
        ui.rideEdit.mode = hit.entry.selected.has(hit.seg.key) ? 'remove' : 'add';
        applyRidePaint(hit);
    });
    container.addEventListener('pointermove', (e) => {
        if (!ui.rideEdit || !ui.rideEdit.dragging) return;
        const [x, y] = xy(e);
        applyRidePaint(rideHitTest(x, y));
    });
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
