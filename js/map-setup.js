// ── 6. MAP INITIALISATION ─────────────────────────────────────────────────

import { IS_TOUCH, MAX_ZOOM, BASEMAP_STYLES, BASEMAP_DEFAULT, BASEMAP_LOAD_MS,
         MAPLIBRE_JS_URL, MAPLIBRE_CSS_URL, MAPLIBRE_LEAFLET_URL } from './config.js';
import { ui } from './registry.js';

// Custom touch gestures: double-tap = zoom in, triple-tap = zoom out,
// long-press = nothing. Replaces Leaflet's double-tap zoom so triple-tap
// can be detected cleanly. Single taps still reach markers/lines normally.
const setupTouchGestures = (map) => {
    map.doubleClickZoom.disable();
    const el = map.getContainer();
    L.DomEvent.on(el, 'contextmenu', L.DomEvent.preventDefault);   // no long-press menu
    let count = 0, timer = null, downT = 0, downX = 0, downY = 0, moved = false, multi = false;
    el.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) { multi = true; return; }         // pinch — ignore
        multi = false; moved = false; downT = Date.now();
        downX = e.touches[0].clientX; downY = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
        if (multi || !e.touches.length) return;
        if (Math.abs(e.touches[0].clientX - downX) > 12 ||
            Math.abs(e.touches[0].clientY - downY) > 12) moved = true;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (multi) { multi = false; return; }
        // Taps on popup DOM or on a stamp marker are interactions with THAT
        // element (stamp row press, tap-tap toggle), never zoom gestures.
        if (e.target.closest?.('.leaflet-popup') || e.target.closest?.('.stamp-marker')) {
            count = 0; clearTimeout(timer); return;
        }
        const dur = Date.now() - downT;
        if (dur > 500) { ui.suppressTap = true; count = 0; clearTimeout(timer); return; }  // long press
        if (moved)     { count = 0; clearTimeout(timer); return; }                       // pan
        ui.suppressTap = false;
        count++;
        const rect = el.getBoundingClientRect();
        const pt = L.point(downX - rect.left, downY - rect.top);
        clearTimeout(timer);
        timer = setTimeout(() => {
            // Tap sequences that touched a station dot are collect gestures
            // (tap-tap on a dot toggles its stamp) — don't also zoom.
            if (Date.now() - (ui.lastStationTap || 0) < 700) { count = 0; return; }
            const ll = map.containerPointToLatLng(pt);
            if (count >= 3)      map.setZoomAround(ll, map.getZoom() - 1);
            else if (count === 2) map.setZoomAround(ll, map.getZoom() + 1);
            count = 0;
        }, 280);
    }, { passive: true });
};

// Raster fallback: standard OSM tiles, darkened in CSS (#map.basemap-raster
// .leaflet-tile-pane filter). CARTO's keyless dark tiles are watermarked now.
const addRasterBasemap = (map) => {
    map.getContainer().classList.add('basemap-raster');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: MAX_ZOOM
    }).addTo(map);
};

const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
});

// Vector basemap (OpenFreeMap via MapLibre GL), loaded after the map is up so a
// slow CDN never delays first paint. Until the style loads the map is bare
// background; any failure before that swaps in the raster fallback.
const addBasemap = (map) => {
    const choice = new URLSearchParams(location.search).get('basemap') || BASEMAP_DEFAULT;
    const styleUrl = BASEMAP_STYLES[choice];
    if (!styleUrl) { addRasterBasemap(map); return; }
    let settled = false;
    let gl = null;
    const fallback = (why) => {
        if (settled) return;
        settled = true;
        console.warn('vector basemap unavailable, using raster tiles:', why);
        if (gl) map.removeLayer(gl);
        addRasterBasemap(map);
    };
    const timer = setTimeout(() => fallback('style load timeout'), BASEMAP_LOAD_MS);
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = MAPLIBRE_CSS_URL;
    document.head.appendChild(css);
    loadScript(MAPLIBRE_JS_URL)
        .then(() => loadScript(MAPLIBRE_LEAFLET_URL))
        .then(() => {
            if (settled) return;
            if (!L.maplibreGL) throw new Error('maplibre-gl-leaflet missing');
            gl = L.maplibreGL({ style: styleUrl, maxZoom: MAX_ZOOM }).addTo(map);
            const glMap = gl.getMaplibreMap();
            glMap.on('error', (e) => { if (!glMap.isStyleLoaded()) fallback(e?.error?.message || 'style error'); });
            glMap.once('load', () => { settled = true; clearTimeout(timer); });
        })
        .catch((err) => { clearTimeout(timer); fallback(err.message); });
};

export const initMap = () => {
    const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([35.682839, 139.759455], 13);
    map.zoomControl.setPosition('bottomleft');   // bottom-left, clear of the top search bar
    // Double click on a STAMP marker toggles the stamp (markers.js) — it must
    // not also zoom. Native doubleClickZoom can't be excluded per-target, so
    // reimplement it with the stamp markers carved out (Leaflet's own default:
    // zoom in, shift = zoom out). Touch replaces this entirely below.
    map.doubleClickZoom.disable();
    map.on('dblclick', (e) => {
        if (e.originalEvent?.target?.closest?.('.stamp-marker')) return;
        map.setZoomAround(e.containerPoint, map.getZoom() + (e.originalEvent?.shiftKey ? -1 : 1));
    });
    // `tolerance` extends the clickable area around thin lines (and markers)
    // so they're easy to hit — the 2.5px lines were nearly impossible to tap,
    // especially on touch. Single shared renderer (see PR #8) so events work.
    ui.canvasRenderer = L.canvas({ padding: 0.5, tolerance: IS_TOUCH ? 12 : 6 });
    addBasemap(map);
    if (IS_TOUCH) setupTouchGestures(map);
    return map;
};
