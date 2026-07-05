/* ==========================================================================
   EKI STAMP TRACKER — entry point (§15 init)
   The app was split from a single index.html into these modules
   (docs/REFACTOR-2026-07.md):
     config, line-colors, state, registry, gist, notify, map-setup, idb-cache,
     geometry (pure), line-geometry, lines, rides, ride-edit, markers,
     search, search-rank (pure), lang, stats, session, main
========================================================================== */

import { state } from './state.js';
import { ui, linesByName, allLineSegs, loadUiColors } from './registry.js';
import { loadFromGist } from './gist.js';
import { initMap } from './map-setup.js';
import { cachePrune } from './idb-cache.js';
import { buildLineGeometry, buildRideSegments } from './line-geometry.js';
import { loadLines } from './lines.js';
import { renderAllRideOverlays } from './rides.js';
import { enterRideEditMode, setupRideEdit } from './ride-edit.js';
import { toggleStamp, refreshAllMarkerStates, loadStations } from './markers.js';
import { setupSearch } from './search.js';
import { setupLanguageToggle } from './lang.js';
import { setupSessionPanel } from './session.js';

// Test hook — the public contract for tooling (scripts/audit-ride-gaps.mjs
// drives the real geometry pipeline through it). Module bindings are not
// visible to page.evaluate, so anything CI needs must be exposed here.
// Extend it; don't reshape it.
window.__eki = { buildLineGeometry, buildRideSegments, linesByName, allLineSegs, ui };

document.addEventListener('DOMContentLoaded', async () => {
    document.documentElement.lang = state.lang === 'jp' ? 'ja' : 'en';   // honour the stored preference
    loadUiColors();   // canvas layers read the CSS color tokens (single source of truth)
    const map   = initMap();
    ui.map = map;
    cachePrune();   // clear other versions' cached data (best-effort)

    setupSearch(map);
    setupLanguageToggle(map);
    setupSessionPanel(map);
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

    // Event delegation for the stamp seal in the station card.
    // Reliable alternative to popupopen+getElement (which returns null in Leaflet);
    // the toggle itself (state, style, seal, toast) lives in toggleStamp.
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.popup-collect-btn');
        if (!btn || !ui.currentPopupMarker) return;
        e.stopPropagation();
        toggleStamp(ui.currentPopupMarker);
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
