/* ==========================================================================
   EKI STAMP TRACKER — entry point (§15 init)
   The app was split from a single index.html into these modules
   (docs/REFACTOR-2026-07.md):
     config, line-colors, state, registry, gist, notify, map-setup, idb-cache,
     geometry (pure), line-geometry, lines, rides, ride-edit, markers,
     search, lang, stats, session, welcome, main
========================================================================== */

import { ICON_STAMP_FILLED, ICON_STAMP_OUTLINE } from './config.js';
import { state } from './state.js';
import { ui, linesByName, allLineSegs } from './registry.js';
import { loadFromGist, scheduleSave } from './gist.js';
import { showToast } from './notify.js';
import { initMap } from './map-setup.js';
import { cachePrune } from './idb-cache.js';
import { buildLineGeometry, buildRideSegments } from './line-geometry.js';
import { loadLines } from './lines.js';
import { renderAllRideOverlays } from './rides.js';
import { enterRideEditMode, setupRideEdit } from './ride-edit.js';
import { circleStyle, buildPopupHtml, refreshAllMarkerStates, loadStations } from './markers.js';
import { setupSearch } from './search.js';
import { setupLanguageToggle } from './lang.js';
import { updateStats } from './stats.js';
import { setupSessionPanel } from './session.js';
import { setupModal } from './welcome.js';

// Test hook — the public contract for tooling (scripts/audit-ride-gaps.mjs
// drives the real geometry pipeline through it). Module bindings are not
// visible to page.evaluate, so anything CI needs must be exposed here.
// Extend it; don't reshape it.
window.__eki = { buildLineGeometry, buildRideSegments, linesByName, allLineSegs, ui };

document.addEventListener('DOMContentLoaded', async () => {
    document.documentElement.lang = state.lang === 'jp' ? 'ja' : 'en';   // honour the stored preference
    const map   = initMap();
    ui.map = map;
    cachePrune();   // clear other versions' cached data (best-effort)

    setupSearch(map);
    setupLanguageToggle(map);
    setupSessionPanel(map);
    setupModal(map);
    setupRideEdit();

    // Event delegation for the line popup's "add a ride" button → map edit mode
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.popup-line-ride-btn');
        if (!btn) return;
        e.stopPropagation();
        const name = decodeURIComponent(btn.dataset.line || '') || ui.currentPopupLine;
        if (!name) return;
        map.closePopup();
        enterRideEditMode(name);
    });

    // Event delegation for popup collect button
    // Reliable alternative to popupopen+getElement (which returns null in Leaflet)
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.popup-collect-btn');
        if (!btn || !ui.currentPopupMarker) return;
        e.stopPropagation();
        const marker = ui.currentPopupMarker;
        const next   = !marker._isCollected;
        marker._isCollected = next;
        state.stamps[next ? 'add' : 'delete'](marker._stationData.code);
        scheduleSave();
        marker.setStyle(circleStyle(next, map.getZoom()));
        if (next) marker.bringToFront();   // gold marker on top of grey ones
        // Update button in-place without rebuilding popup
        btn.className   = 'popup-collect-btn' + (next ? ' collected' : '');
        const ariaName = state.lang === 'jp' ? (marker.stationNameJP || marker.stationNameEN)
                                              : (marker.stationNameEN || marker.stationNameJP);
        btn.setAttribute('aria-label', `${next ? 'Remove stamp' : 'Collect stamp'} for ${ariaName}`);
        btn.innerHTML   = `${next ? ICON_STAMP_FILLED : ICON_STAMP_OUTLINE} ${next ? 'Collected' : 'Collect stamp'}`;
        // Keep stored popup HTML in sync for next open
        marker.setPopupContent(buildPopupHtml(marker));
        updateStats();
        showToast(next ? `${marker.stationName} — stamped!` : `${marker.stationName} — removed`);
    });

    // Load stations first (they appear fast, often from cache)
    await loadStations(map);

    // Load lines in background shortly after — they are visually large and slow
    setTimeout(() => loadLines(map), 100);

    // If returning user, load their stamps
    if (state.user) {
        await loadFromGist(state.user);
        refreshAllMarkerStates();
        renderAllRideOverlays();
    }
});
