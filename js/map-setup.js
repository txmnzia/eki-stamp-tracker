// ── 6. MAP INITIALISATION ─────────────────────────────────────────────────

import { IS_TOUCH, MAX_ZOOM } from './config.js';
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
    el.addEventListener('touchend', () => {
        if (multi) { multi = false; return; }
        const dur = Date.now() - downT;
        if (dur > 500) { ui.suppressTap = true; count = 0; clearTimeout(timer); return; }  // long press
        if (moved)     { count = 0; clearTimeout(timer); return; }                       // pan
        ui.suppressTap = false;
        count++;
        const rect = el.getBoundingClientRect();
        const pt = L.point(downX - rect.left, downY - rect.top);
        clearTimeout(timer);
        timer = setTimeout(() => {
            const ll = map.containerPointToLatLng(pt);
            if (count >= 3)      map.setZoomAround(ll, map.getZoom() - 1);
            else if (count === 2) map.setZoomAround(ll, map.getZoom() + 1);
            count = 0;
        }, 280);
    }, { passive: true });
};

export const initMap = () => {
    const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([35.682839, 139.759455], 13);
    map.zoomControl.setPosition('bottomleft');   // bottom-left, clear of the top search bar
    // `tolerance` extends the clickable area around thin lines (and markers)
    // so they're easy to hit — the 2.5px lines were nearly impossible to tap,
    // especially on touch. Single shared renderer (see PR #8) so events work.
    ui.canvasRenderer = L.canvas({ padding: 0.5, tolerance: IS_TOUCH ? 12 : 6 });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd', maxZoom: MAX_ZOOM
    }).addTo(map);
    if (IS_TOUCH) setupTouchGestures(map);
    return map;
};
