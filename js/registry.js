// ── 3b. SHARED REGISTRIES ─────────────────────────────────────────────────
// The layer collections and cross-module runtime scalars that the old
// single-file app shared as script-level globals. Collections are exported
// consts mutated in place (same reference semantics as before); scalars that
// more than one module writes live on `ui`, because an imported let binding
// can be read but never assigned by the importer. Scalars used by a single
// module stay module-local — don't move them here without a second writer.

import { state } from './state.js';
import { getLineEn } from './line-colors.js';

// Markers
export const markers       = [];  // STAMP stations only (drive stats + search)
export const plainMarkers  = [];  // every other ekidata station — discreet, clickable, no stamp
export const dedupeMarkers = {};

// Lines
export const lineColorMap  = {};  // lineName → hex colour (populated during renderLines)
export const lineEnMap     = {};  // lineName (kanji) → English romaji name (populated during loadStations)
export const linesByName   = {};  // lineName → [polyline, ...]
export const allLineSegs   = [];  // flat array for bulk opacity resets

// Ride-section feature
export const allStations   = [];  // flat [{code,name_kanji,name_en,lat,lon}] from ekidata (for the ride picker)
export const lineGroups    = [];  // ekidata lines, each with its stations IN ORDER (authoritative station list)
export const stationByCode = {};  // ekidata code → station record (for seeding overlays from saved rides)
export const lineGeomCache = {};  // cacheKey(name|bucket) → { chains, stations } computed lazily
export const rideOverlays  = {};  // lineName → [polyline, ...] bright "ridden stretch" overlays
export const shinkansenData = {}; // 路線名 → { name_en, color, stations:[ordered] } curated Shinkansen
export const shinkansenGeo  = {}; // 路線名 → [ [lat,lng]... ] bundled track fragments (captured in renderLines)

// Cross-module runtime scalars (each has at least two writer modules).
export const ui = {
    map:            null,   // the Leaflet map (assigned once in main.js init)
    canvasRenderer: null,   // single shared canvas renderer (assigned in initMap)
    // True once EVERY line feature has been drawn. Ride geometry must never be
    // built (or cached) before then: a graph over a partially-rendered line gets
    // cached in lineGeomCache and shows phantom overlay gaps for the whole
    // session. (scripts/audit-ride-gaps.mjs documents the same failure mode.)
    linesReady:     false,
    // Set true by a long press so the following synthetic click is ignored.
    suppressTap:    false,
    // Popup tracking
    currentPopupMarker: null,
    currentPopupLine:   null,   // line whose popup is open (for the ride button)
    linePopupSeed:      null,   // {lat,lng} where the open line popup was clicked (corridor seed)
    rideEdit:           null,   // active ride edit session (or null) — see ride-edit.js
    // Timestamp of the last tap that landed on a station marker. The touch
    // double-tap-zoom gesture checks it so that tap-dot-then-tap-again (the
    // stamp-collect gesture) never doubles as a zoom (map-setup.js).
    lastStationTap:     0,
};

// UI colors for the canvas layers (markers, line fallbacks), read from the
// CSS design tokens at boot (main.js) so the map and the chrome can never
// drift apart (docs/DESIGN_SYSTEM.md §2.1). Canvas needs concrete color
// strings, hence the copy — the tokens stay the single source of truth
// (the literals below are only a pre-boot fallback).
export const uiColors = {
    gold: '#f7c948', markerIdle: '#9aa0ac', lineUnknown: '#6b6b7a',
    accent: '#7eb8f7', bg: '#0f0f12',
};
export const loadUiColors = () => {
    const cs = getComputedStyle(document.documentElement);
    const read = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
    uiColors.gold        = read('--gold', uiColors.gold);
    uiColors.markerIdle  = read('--marker-idle', uiColors.markerIdle);
    uiColors.lineUnknown = read('--line-unknown', uiColors.lineUnknown);
    uiColors.accent      = read('--accent', uiColors.accent);
    uiColors.bg          = read('--bg', uiColors.bg);
};
// #rrggbb → rgba() string for canvas strokes that need transparency.
export const hexA = (hex, a) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r},${g},${b},${a})`;
};

// HTML-escape for every name interpolated into popup/tooltip markup. Names
// come from a SCRAPED external site, so a compromised upstream page must
// never become script running in users' browsers.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Order a line's kanji + English names by the current UI language.
 * EN mode → English primary, kanji secondary; JP mode → the reverse.
 * Mirrors the station-name primary/secondary behaviour.
 */
export const orderLineNames = (kanji) => {
    const en        = lineEnMap[kanji] || getLineEn(kanji);
    const primary   = state.lang === 'jp' ? kanji : (en || kanji);
    const secondary = state.lang === 'jp' ? en : kanji;
    return { primary, secondary: (secondary && secondary !== primary) ? secondary : '' };
};
