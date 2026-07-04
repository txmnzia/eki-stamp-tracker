// ── 7. LINE RENDERING ─────────────────────────────────────────────────────
// Draws the GeoJSON lines (RAF-batched) and the curated Shinkansen, and
// wires the shared hover/tap/popup behaviour. Runtime-only cycle with
// rides.js (onLinesReady → renderAllRideOverlays).

import { APP_VERSION, CACHE_TTL, BATCH_SIZE, HOVER_RESET_MS, LINE_BASE, SHINKANSEN_BASE,
         LINE_DIM, LINE_FOCUS, ICON_RIDE } from './config.js';
import { getLineColor } from './line-colors.js';
import { state } from './state.js';
import { ui, linesByName, allLineSegs, lineColorMap, lineEnMap, lineGeomCache,
         shinkansenData, shinkansenGeo, esc, orderLineNames } from './registry.js';
import { cacheGet, cacheSet } from './idb-cache.js';
import { showToast } from './notify.js';
import { shinkansenPath } from './line-geometry.js';
import { renderAllRideOverlays } from './rides.js';
import { bringStationsToFront } from './markers.js';

let hoveredLine = null;
let hoverTimer;

export const resetAllLines = () => {
    allLineSegs.forEach(p => p.setStyle(p._baseStyle || LINE_BASE));
};

// Highlight every segment of a line (dim the rest). Shared by hover (desktop)
// and tap (touch) so lines are usable without a mouse.
const highlightLine = (name, map) => {
    if (ui.rideEdit) return;   // no hover-highlight while editing a ride (distracting)
    clearTimeout(hoverTimer);
    // Dismiss a hover-opened station popup when moving onto a line, but never a
    // click-pinned popup (line "add a ride" / clicked station) — the user may be
    // crossing a line on the way to its button, and that must not close it.
    if (map && ui.currentPopupMarker && ui.currentPopupMarker._hoverOpened) {
        map.closePopup(); ui.currentPopupMarker = null;
    }
    if (hoveredLine === name) return;
    const prev = hoveredLine;
    hoveredLine = name;
    if (prev === null) {
        allLineSegs.forEach(p => p.setStyle(LINE_DIM));
    } else {
        linesByName[prev]?.forEach(p => p.setStyle(LINE_DIM));
    }
    linesByName[name]?.forEach(p => p.setStyle(LINE_FOCUS));
};

/** Popup shown when a line is clicked — carries the "add a ride" button. */
const buildLinePopupHtml = (name) => {
    const { primary, secondary } = orderLineNames(name);
    const color   = lineColorMap[name] || '#6b6b7a';
    const ridden  = state.rides[name]?.length || 0;
    const summary = ridden ? 'Ride logged — edit it on the map' : 'No ride logged yet';
    const label   = ridden ? 'Edit ride' : 'Add a ride';
    const btnCls  = 'popup-line-ride-btn' + (ridden ? ' has-rides' : '');
    const nameHtml = secondary
        ? `<span class="popup-line-label"><span class="popup-line-jp">${esc(primary)}</span><span class="popup-line-en">${esc(secondary)}</span></span>`
        : `<span class="popup-line-jp">${esc(primary)}</span>`;
    return `<div class="popup-inner">
        <div class="popup-line" style="margin-bottom:6px"><span class="popup-line-dot" style="background:${esc(color)}"></span>${nameHtml}</div>
        <div class="popup-ride-summary">${summary}</div>
        <button class="${btnCls}" data-line="${encodeURIComponent(name)}" aria-label="${esc(label + ' on ' + primary)}">${ICON_RIDE} ${label}</button>
    </div>`;
};

// Wire the shared hover/tap/popup behaviour onto a line polyline (used by both
// the GeoJSON lines and the curated Shinkansen polylines, so they feel identical).
const attachLineInteractions = (polyline, name, map) => {
    polyline.bindTooltip(
        () => {
            const { primary, secondary } = orderLineNames(name);
            return `<div class="line-tip"><b>${esc(primary)}</b>${secondary ? `<br><span>${esc(secondary)}</span>` : ''}</div>`;
        },
        { sticky: true, direction: 'top', offset: [0, -8], className: 'line-tooltip' }
    );
    polyline.bindPopup(() => buildLinePopupHtml(name),
        { offset: L.point(0, -4), closeButton: true, maxWidth: 260, className: 'line-popup' });
    polyline.on('mouseover', () => highlightLine(name, map));
    polyline.on('mouseout', () => {
        if (ui.rideEdit) return;
        hoverTimer = setTimeout(() => { hoveredLine = null; resetAllLines(); }, HOVER_RESET_MS);
    });
    polyline.on('click', (e) => {
        if (ui.suppressTap) { ui.suppressTap = false; return; }   // ignore long-press
        if (ui.rideEdit) return;   // ignore other lines while editing a ride
        L.DomEvent.stopPropagation(e);
        highlightLine(name, map);
        ui.currentPopupLine = name;
        ui.linePopupSeed = e.latlng;   // remember where on the corridor we clicked
        polyline.closeTooltip();
        polyline.openPopup(e.latlng);
    });
    polyline.on('popupclose', () => { if (ui.currentPopupLine === name) ui.currentPopupLine = null; });
};
// Draw the curated Shinkansen lines (smooth curve through their real stops). The
// bundled rail geometry has almost no Shinkansen track, so its broken fragments
// are skipped in renderLines and replaced by these complete, smooth lines.
const drawShinkansen = (map) => {
    Object.entries(shinkansenData).forEach(([name, info]) => {
        if (linesByName[name]) return;
        const color = info.color || '#888';
        lineColorMap[name] = color;
        if (info.name_en) lineEnMap[name] = info.name_en;
        const pl = L.polyline(shinkansenPath(name).coords,
            { color, ...SHINKANSEN_BASE, renderer: ui.canvasRenderer, interactive: true }).addTo(map);
        pl._baseStyle = SHINKANSEN_BASE;
        linesByName[name] = [pl];
        allLineSegs.push(pl);
        attachLineInteractions(pl, name, map);
    });
    resetAllLines();
};

/**
 * Render GeoJSON line features onto the map using RAF batching.
 * @param {L.Map} map
 * @param {Object} geojson - GeoJSON FeatureCollection
 * @param {Function} [onComplete] - called when all batches finish
 */
const renderLines = (map, geojson, onComplete) => {
    const features = geojson.features;
    let i = 0;

    const processBatch = () => {
        const end = Math.min(i + BATCH_SIZE, features.length);
        for (; i < end; i++) {
            const { properties, geometry } = features[i];
            const name  = properties.路線名;
            if (name.includes('新幹線')) {           // not drawn here (curated layer draws it),
                // but keep its real track fragments so the curated line can follow them.
                (shinkansenGeo[name] = shinkansenGeo[name] || []).push(
                    geometry.coordinates.map(([lng, lat]) => [lat, lng]));
                continue;
            }
            const color = getLineColor(name);
            lineColorMap[name] = color;

            const polyline = L.polyline(
                geometry.coordinates.map(([lng, lat]) => [lat, lng]),
                { color, ...LINE_BASE, renderer: ui.canvasRenderer, interactive: true }
            ).addTo(map);

            if (!linesByName[name]) linesByName[name] = [];
            linesByName[name].push(polyline);
            allLineSegs.push(polyline);
            attachLineInteractions(polyline, name, map);
        }

        if (i < features.length) {
            requestAnimationFrame(processBatch);
        } else {
            resetAllLines(); // ensure correct initial opacity after all lines are drawn
            onComplete?.();
        }
    };

    requestAnimationFrame(processBatch);
};
const loadShinkansen = async () => {
    try {
        const d = await fetch('data/shinkansen.json').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
        Object.assign(shinkansenData, d);
    } catch (err) { console.error('loadShinkansen:', err); }
};

export const loadLines = async (map) => {
    await loadShinkansen();   // ready before onLinesReady draws them
    // After lines are drawn, restack markers, draw Shinkansen, paint ride overlays.
    const onLinesReady = () => {
        ui.linesReady = true;
        // Anything built against a partial render is wrong — drop it.
        Object.keys(lineGeomCache).forEach(k => delete lineGeomCache[k]);
        bringStationsToFront(true); drawShinkansen(map); renderAllRideOverlays();
    };
    try {
        // Versioned like the station cache, so bumping APP_VERSION really does
        // ship fresh track geometry to every client (README promises this).
        const cached = await cacheGet(`eki_lines_${APP_VERSION}`);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
            renderLines(map, cached.data, onLinesReady);
            return;
        }
    } catch { /* cache miss is fine */ }

    try {
        const data = await fetch('data/railroad-section.geojson').then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        });
        renderLines(map, data, onLinesReady);
        cacheSet(`eki_lines_${APP_VERSION}`, { data, ts: Date.now() }).catch(() => {});
    } catch (err) {
        console.error('loadLines:', err);
        showToast('Failed to load train lines — map may be incomplete', 4000);
    }
};
