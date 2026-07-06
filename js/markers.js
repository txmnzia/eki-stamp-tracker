// ── 8+9. MARKERS & STATION POPUP ──────────────────────────────────────────
// Marker styles/creation, the station popup HTML, and loadStations (the
// ekidata + stamp-catalogue join that populates the registries).

import { APP_VERSION, CACHE_TTL, IS_TOUCH, MARKER_BASE_R,
         MARKER_ABS_MIN, MARKER_MAX_R, ZOOM_BASE, ZOOM_SCALE,
         STAMP_TOGGLE_GUARD_MS, STAMP_DBL_MS, PLAIN_MIN_ZOOM,
         STAMP_ICON_PX, STAMP_SIZE_FACTOR, STAMP_MIN_SCALE_TOUCH,
         ICON_STAMP_MARKER } from './config.js';
import { state } from './state.js';
import { ui, markers, plainMarkers, dedupeMarkers, lineColorMap, lineEnMap, allStations,
         lineGroups, stationByCode, esc, orderLineNames, uiColors } from './registry.js';
import { cacheGet, cacheSet } from './idb-cache.js';
import { scheduleSave } from './gist.js';
import { showToast, hideLoading } from './notify.js';
import { updateStats } from './stats.js';

let zoomDebounce;

// Stamped markers rise above unstamped ones (DOM z-index), so progress reads
// at a glance where icons overlap when zoomed out.
export const bringCollectedToFront = () => {
    markers.forEach(m => m.setZIndexOffset?.(m._isCollected ? 1000 : 0));
};

// True while the plain (non-stamp) markers are pulled off the map on touch —
// below PLAIN_MIN_ZOOM they are noise that buries the stamp icons (F-6).
let plainHidden = false;
const updatePlainVisibility = (map) => {
    const hide = IS_TOUCH && map.getZoom() < PLAIN_MIN_ZOOM;
    if (hide === plainHidden) return;
    plainHidden = hide;
    plainMarkers.forEach(m => hide ? m.removeFrom(map) : m.addTo(map));
};

// Re-add the CANVAS plain dots so they draw above freshly-drawn lines. The
// stamp markers are DOM (marker pane) — always above the canvas, no restack.
export const bringStationsToFront = (includePlain = false) => {
    if (!ui.map) return;
    if (includePlain && !plainHidden) plainMarkers.forEach(m => { m.removeFrom(ui.map); m.addTo(ui.map); });
};
// ── 8. MARKER MANAGEMENT ──────────────────────────────────────────────────

/**
 * Derive the display name for a station in the current language.
 * EN mode: English romanisation (from station code). JP mode: kanji.
 */
export const getDisplayName = (station, code) => {
    if (state.lang === 'jp' && station.name_kanji) return station.name_kanji;
    // Use explicit English name if present (ekidata stations have this field)
    if (station.name_en) return station.name_en;
    // Legacy fallback: derive from dotted code (e.g. "JR.East.TokyoStation" → "Tokyo Station")
    const raw = (code ?? '').includes('.') ? code.split('.').pop() : (code ?? '');
    return raw.replace(/([A-Z])/g, ' $1').trim() || station.name_kanji || code || '?';
};

// Returns the English name for a station. Accepts the full station object
// so it can use the explicit name_en field (ekidata) before falling back
// to the legacy code-parsing approach.
export const getEnName = (station, code) => {
    if (station?.name_en) return station.name_en;
    const raw = (code ?? '').includes('.') ? code.split('.').pop() : (code ?? '');
    return raw.replace(/([A-Z])/g, ' $1').trim();
};

// Non-stamp stations: light grey CANVAS dots — context, not targets. Still
// clickable for a name/lines popup where they're visible.
const plainStyle = (zoom) => {
    const base = MARKER_BASE_R * Math.pow(ZOOM_SCALE, zoom - ZOOM_BASE);
    return {
        radius: Math.min(MARKER_MAX_R, Math.max(MARKER_ABS_MIN, base)),
        fillColor: uiColors.markerIdle, fillOpacity: 0.18, color: uiColors.markerIdle, weight: 0,
        renderer: ui.canvasRenderer,
    };
};

// Stamp stations: the dot IS the stamp — a DOM marker with the hand-stamp
// glyph (grey = collectible, ink red = stamped; state lives in the `stamped`
// class, colors in css/app.css). One shared divIcon: Leaflet clones its HTML
// per marker. keyboard:false — 2.4k tab stops would wreck keyboard use; the
// accessible toggle is the popup's stamp row.
const STAMP_DIV_ICON = L.divIcon({
    className: 'stamp-marker',
    html: ICON_STAMP_MARKER,
    iconSize: [STAMP_ICON_PX, STAMP_ICON_PX],
    iconAnchor: [STAMP_ICON_PX / 2, STAMP_ICON_PX / 2],
    popupAnchor: [0, -STAMP_ICON_PX / 2],
    tooltipAnchor: [0, -STAMP_ICON_PX / 2],
});

// All 2.4k badges scale via ONE custom property on the map container — a
// single style write per zoom instead of rebuilding every icon. The badge
// follows the SAME size curve as the plain dots (×STAMP_SIZE_FACTOR, ring
// included) so stamp and non-stamp stations stay visually consistent.
const applyStampScale = (map) => {
    const r = Math.min(MARKER_MAX_R, Math.max(MARKER_ABS_MIN,
              MARKER_BASE_R * Math.pow(ZOOM_SCALE, map.getZoom() - ZOOM_BASE)));
    let s = (2 * r * STAMP_SIZE_FACTOR) / STAMP_ICON_PX;
    if (IS_TOUCH) s = Math.max(s, STAMP_MIN_SCALE_TOUCH);   // tap floor (plain dots hidden at these zooms)
    map.getContainer().style.setProperty('--stamp-scale', s.toFixed(3));
};

// ── 9. POPUP ──────────────────────────────────────────────────────────────

/**
 * Build the popup HTML for a station marker.
 * Language-aware: primary name is in the current UI language.
 */
export const buildPopupHtml = (marker) => {
    const s    = marker._stationData;
    const code = s.code;
    const jp   = s.name_kanji || '';
    const en   = getEnName(s, code);

    // Language-sensitive primary / secondary names
    const primary   = state.lang === 'jp' ? (jp || en) : (en || jp);
    const secondary = state.lang === 'jp' ? en : jp;

    const lineBadges = (marker._lineCodes ?? [s.line_code]).filter(Boolean).map(lc => {
        const color = lineColorMap[lc] ?? uiColors.lineUnknown;
        const { primary, secondary } = orderLineNames(lc);
        const label = secondary
            ? `<span class="popup-line-label"><span class="popup-line-jp">${esc(primary)}</span><span class="popup-line-en">${esc(secondary)}</span></span>`
            : `<span class="popup-line-jp">${esc(primary)}</span>`;
        return `<div class="popup-line"><span class="popup-line-dot" style="background:${esc(color)}"></span>${label}</div>`;
    }).join('');

    // ONE popup layout for every station (docs mock-up): a header row with the
    // station name on the left and — for stamp stations — the stamp badge on
    // the right, a divider, then the line badges stacked. Fixed width, so every
    // popup is the same size regardless of name/line lengths. The badge is the
    // discoverable, keyboard- and colorblind-safe toggle (click it; the map pin
    // also toggles on double click). Same ring glyph as the map marker.
    const collected = !marker._noStamp && marker._isCollected;
    const stampBadge = marker._noStamp ? '' :
        `<button class="popup-collect-btn${collected ? ' collected' : ''}"
                 title="${collected ? 'Remove stamp' : 'Collect stamp'}"
                 aria-label="${esc(`${collected ? 'Remove stamp' : 'Collect stamp'} for ${primary}`)}"
                 aria-pressed="${collected}">${ICON_STAMP_MARKER}</button>`;
    return `<div class="popup-inner${marker._noStamp ? ' nostamp' : ''}">
        <div class="popup-head">
            <div class="popup-name-wrap">
                <div class="popup-name">${esc(primary)}</div>
                ${secondary ? `<div class="popup-name-secondary">${esc(secondary)}</div>` : ''}
            </div>
            ${stampBadge}
        </div>
        ${lineBadges ? `<div class="popup-lines">${lineBadges}</div>` : ''}
    </div>`;
};

// Reflect a marker's stamped state onto its DOM element (glyph color + stack
// order). `justNow` also replays the ink-press animation.
const paintStampMarker = (marker, justNow = false) => {
    const el = marker.getElement?.();
    if (el) {
        el.classList.toggle('stamped', marker._isCollected);
        el.classList.remove('just-stamped');
        if (justNow && marker._isCollected) {
            void el.offsetWidth;   // restart the CSS animation
            el.classList.add('just-stamped');
        }
    }
    marker.setZIndexOffset?.(marker._isCollected ? 1000 : 0);
};

/**
 * Toggle a station's stamp — THE collect action, shared by double-clicking
 * the marker and by the popup's stamp row (event delegation in main.js).
 * A short guard window means a stray triple click can't toggle twice.
 */
export const toggleStamp = (marker) => {
    if (!marker || marker._noStamp) return;
    const now = Date.now();
    if (now - (marker._lastToggleAt || 0) < STAMP_TOGGLE_GUARD_MS) return;
    marker._lastToggleAt = now;

    const next = !marker._isCollected;
    marker._isCollected = next;
    state.stamps[next ? 'add' : 'delete'](marker._stationData.code);
    scheduleSave();
    paintStampMarker(marker, true);

    // Update the stamp badge in place if the popup is open (popup HTML is
    // otherwise a function, rebuilt on next open — no manual sync needed). Only
    // the collected class + labels change; the ring glyph is the same markup.
    const btn = marker.getPopup()?.getElement()?.querySelector('.popup-collect-btn');
    if (btn) {
        const ariaName = state.lang === 'jp' ? (marker.stationNameJP || marker.stationNameEN)
                                             : (marker.stationNameEN || marker.stationNameJP);
        btn.classList.toggle('collected', next);
        btn.title = next ? 'Remove stamp' : 'Collect stamp';
        btn.setAttribute('aria-label', `${next ? 'Remove stamp' : 'Collect stamp'} for ${ariaName}`);
        btn.setAttribute('aria-pressed', String(next));
    }
    updateStats();
    showToast(next ? `${marker.stationName} — stamped!` : `${marker.stationName} — removed`);

    // One-time nudge after the very first stamp, now that the welcome modal is
    // gone: the map is the welcome, the Session panel is where naming lives.
    if (next && state.stamps.size === 1 && !state.user && !localStorage.getItem('eki_first_stamp_hint')) {
        try { localStorage.setItem('eki_first_stamp_hint', '1'); } catch { /* storage blocked */ }
        setTimeout(() => showToast('Saved on this device — open Session to name & sync your collection', 5000), 1800);
    }
};

export const dedupeKey = (s) => `${s.name_kanji}|${s.lat.toFixed(2)}|${s.lon.toFixed(2)}`;

/**
 * Create (or merge into existing) a station circle marker.
 * Stations sharing name + ~1km grid cell are collapsed into one marker
 * with a multi-line badge popup.
 */
const createMarker = (station, map, plain = false) => {
    const { code, line_code } = station;
    // line_code may be empty for funakiya-only stamps (defunct lines with no
    // ekidata row) — they still get a marker, just without a line badge.
    if (!code) return;

    const key = dedupeKey(station);
    const existing = dedupeMarkers[key];

    if (existing) {
        if (line_code && !existing._lineCodes.includes(line_code)) {
            existing._lineCodes.push(line_code);
            // Popup content is a function (rebuilt on open), so no sync needed here.
        }
        return;
    }

    const collected = !plain && state.stamps.has(code);
    const marker = plain
        ? L.circleMarker([station.lat, station.lon], plainStyle(map.getZoom()))
        : L.marker([station.lat, station.lon], { icon: STAMP_DIV_ICON, keyboard: false });

    marker._stationData  = station;
    marker._isCollected  = collected;
    marker._noStamp      = plain;
    marker._lineCodes    = line_code ? [line_code] : [];
    marker.stationName   = getDisplayName(station, code);
    marker.stationNameJP = station.name_kanji || '';
    marker.stationNameEN = getEnName(station, code);

    // Hover = the station's name only, in the same lightweight tooltip the
    // lines use (content is a function → language-aware on every open).
    marker.bindTooltip(() => {
        const primary   = state.lang === 'jp' ? (marker.stationNameJP || marker.stationNameEN)
                                              : (marker.stationNameEN || marker.stationNameJP);
        const secondary = state.lang === 'jp' ? marker.stationNameEN : marker.stationNameJP;
        return `<div class="line-tip"><b>${esc(primary)}</b>${secondary ? `<br><span>${esc(secondary)}</span>` : ''}</div>`;
    }, { direction: 'top', offset: plain ? [0, -8] : [0, -STAMP_ICON_PX / 2], className: 'line-tooltip' });

    // Click = the compact info popup (function content → rebuilt on open, so
    // it always reflects current stamp state and language). Plain canvas dots
    // need an explicit offset; stamp markers get theirs from the divIcon's
    // popupAnchor — passing `offset: undefined` would clobber Leaflet's
    // default and break popup positioning, so the key is only set for plain.
    const popupOpts = { closeButton: true, maxWidth: 260 };
    if (plain) popupOpts.offset = L.point(0, -4);
    marker.bindPopup(() => buildPopupHtml(marker), popupOpts);
    // bindPopup installs Leaflet's own click→toggle-popup handler, which would
    // fight the click-pair logic below (popping the popup open/closed on every
    // click without tracking ui.currentPopupMarker). Same removal as lines.js.
    marker.off('click', marker._openPopup, marker);

    if (plain) {
        // Plain station: single click/tap opens the popup. Nothing to toggle.
        marker.on('click', () => {
            if (ui.suppressTap) { ui.suppressTap = false; return; }   // ignore long-press
            if (ui.rideEdit) return;   // stations aren't clickable while editing a ride
            ui.lastStationTap = Date.now();
            ui.currentPopupMarker = marker;
            marker.openPopup();
        });
    } else {
        // Stamp station: double click/tap toggles the stamp; a lone click
        // opens the info popup after the pair window. Own click-pair counting
        // (not native dblclick) so desktop and touch behave identically.
        // If the popup was open when the click landed, the lone click acts as
        // a dismiss (Leaflet's preclick already closed it — don't reopen).
        marker.on('preclick', () => {
            marker._popupWasOpen = marker.isPopupOpen?.() && ui.currentPopupMarker === marker;
        });
        marker.on('click', () => {
            if (ui.suppressTap) { ui.suppressTap = false; return; }   // ignore long-press
            if (ui.rideEdit) return;   // stations aren't clickable while editing a ride
            ui.lastStationTap = Date.now();
            if (marker._clickArmed) {                     // second click of a pair → toggle
                clearTimeout(marker._clickTimer);
                marker._clickArmed = false;
                toggleStamp(marker);
                return;
            }
            marker._clickArmed = true;
            const wasOpen = marker._popupWasOpen;
            marker._clickTimer = setTimeout(() => {
                marker._clickArmed = false;
                if (wasOpen) return;                      // lone click on an open popup = dismiss
                ui.currentPopupMarker = marker;
                marker.openPopup();
            }, STAMP_DBL_MS);
        });
    }

    // Clear tracking state when popup closes for any reason.
    marker.on('popupclose', () => {
        if (ui.currentPopupMarker === marker) ui.currentPopupMarker = null;
    });

    dedupeMarkers[key] = marker;
    (plain ? plainMarkers : markers).push(marker);
    marker.addTo(map);
    if (!plain) paintStampMarker(marker);   // element exists only after addTo
};
export const refreshAllMarkerStates = () => {
    if (!ui.map) return;
    ui.map.closePopup();
    markers.forEach(m => {
        m._isCollected = state.stamps.has(m._stationData.code);
        paintStampMarker(m);
        // Popup content is a function (rebuilt on open) — no need to re-push HTML.
    });
    updateStats();
};

export const loadStations = async (map) => {
    // `stampNames` maps an ekidata station code -> the curated English name
    // from Funakiya. Only stations present in this map have a real eki stamp
    // and are rendered; their English names override ekidata's (which is
    // auto-romanised and often wrong, e.g. 米原 Maibara -> "Yonehara").
    const renderStations = (stations, stampNames, lineNames, orphanStamps) => {
        // Funakiya's properly spaced English line names take precedence over
        // ekidata's run-together romaji (e.g. "Jrtokaidohonsen(Tokyo~Atami)").
        Object.assign(lineEnMap, lineNames || {});

        // Retain a flat list of every ekidata station with coordinates — the
        // pool the ride picker snaps onto a clicked line's geometry.
        // Resolve a good English name for every station, since ekidata's raw
        // auto-romaji is often wrong (四ツ谷 "Shitsutani", 新高円寺 "Niitakaentera").
        // 1) Funakiya curated names (stamp stations) are the source of truth, with
        //    the network qualifier stripped (中野坂上 "Toei Subway Nakano-sakaue" →
        //    "Nakano-sakaue"). 2) For an un-curated compound station, compose from a
        //    known directional prefix + a curated base (新高円寺 → Shin-Kōenji).
        //    3) ekidata romaji only as a last resort.
        const normK   = (k) => (k || '').replace(/ヶ/g, 'ケ');
        const cleanEn = (en) => (en || '').replace(/^(Toei Subway|Tokyo Metro)\s+/, '');
        const curatedByKanji = {};
        stations.forEach(g => g.stations.forEach(s => {
            const en = stampNames[s.code];
            if (en) { const k = normK(s.name_kanji); if (!curatedByKanji[k]) curatedByKanji[k] = cleanEn(en); }
        }));
        const PREFIX = { '新': 'Shin', '西': 'Nishi', '東': 'Higashi', '南': 'Minami', '北': 'Kita', '上': 'Kami', '下': 'Shimo', '元': 'Moto', '本': 'Hon' };
        const resolveEn = (s) => {
            const k = normK(s.name_kanji);
            if (curatedByKanji[k]) return curatedByKanji[k];                       // curated, cleaned
            const p = PREFIX[k[0]], base = curatedByKanji[k.slice(1)];
            if (p && base) return p + '-' + base;                                  // composed (Shin-…)
            return s.name_en;                                                      // ekidata fallback
        };

        allStations.length = 0; lineGroups.length = 0;
        stations.forEach(g => {
            const ordered = [];
            g.stations.forEach(s => {
                if (s.lat && s.lon) {
                    const rec = { code: s.code, name_kanji: s.name_kanji, name_en: resolveEn(s), lat: s.lat, lon: s.lon };
                    allStations.push(rec);
                    stationByCode[s.code] = rec;
                    ordered.push(rec);
                }
            });
            if (ordered.length) lineGroups.push({ line_name: g.line_name, stations: ordered });
        });

        // A stamp belongs to a physical station, not a single line. Funakiya
        // matches each stamp to one ekidata row, but an interchange (Tokyo,
        // Shinjuku…) has several rows at the same place. So we render every
        // ekidata line-row at a stamped location and let createMarker merge
        // them into one marker showing all its lines.
        const stampedLoc = {};   // dedupeKey -> curated English name (or null)
        stations.forEach(g => g.stations.forEach(s => {
            const en = stampNames[s.code];
            if (en === undefined) return;
            const k = dedupeKey(s);
            if (!(k in stampedLoc)) stampedLoc[k] = en || null;
        }));

        // Pass C: every OTHER station (nowhere stamped at its location) as a
        // discreet, clickable non-stamp marker. Created BEFORE the stamp passes
        // (stamp markers are DOM, always above these canvas dots). Same name
        // resolver so the
        // romaji is decent. These live in plainMarkers (excluded from stats/search).
        stations.forEach(g => {
            if (g.line_name_en && !lineEnMap[g.line_name]) lineEnMap[g.line_name] = g.line_name_en;
            g.stations.forEach(s => {
                if (!s.lat || !s.lon || dedupeKey(s) in stampedLoc) return;
                s.name_en = resolveEn(s);
                createMarker(s, map, true);
            });
        });

        // Pass A: create markers from the matched rows first, so each
        // marker's identity (its stamp code) is the matched ekidata code —
        // keeps saved progress lighting up correctly.
        stations.forEach(g => {
            if (g.line_name_en && !lineEnMap[g.line_name]) lineEnMap[g.line_name] = g.line_name_en;
            g.stations.forEach(s => {
                if (stampNames[s.code] === undefined) return;
                const en = stampedLoc[dedupeKey(s)];
                if (en) s.name_en = en;
                createMarker(s, map);
            });
        });
        // Pass B: add the station's other lines (rows at a stamped location
        // that aren't themselves the matched row) so all line badges show.
        stations.forEach(g => g.stations.forEach(s => {
            if (stampNames[s.code] !== undefined) return;   // handled in pass A
            const k = dedupeKey(s);
            if (!(k in stampedLoc)) return;
            const en = stampedLoc[k];
            if (en) s.name_en = en;
            createMarker(s, map);
        }));
        // Pass D: funakiya-only stamp stations (defunct JNR / third-sector
        // lines with no ekidata row at all). They carry their own curated
        // coords/names and an fk_* code, which works with state.stamps like
        // any other — without this pass 84 real stamps could never be seen.
        (orphanStamps || []).forEach(s => {
            createMarker({ code: s.code, name_kanji: s.name_kanji, name_en: s.name_en,
                           lat: s.lat, lon: s.lon,
                           line_code: (s.lines && s.lines[0]) || '' }, map);
        });
        map.on('zoomend', () => {
            applyStampScale(map);   // one CSS-var write scales every stamp glyph
            clearTimeout(zoomDebounce);
            zoomDebounce = setTimeout(() => {
                const zoom = map.getZoom();
                updatePlainVisibility(map);
                plainMarkers.forEach(m => m.setStyle(plainStyle(zoom)));
            }, 150);
        });
        applyStampScale(map);
        updatePlainVisibility(map);
        updateStats();
        hideLoading();
    };

    try {
        const cached = await cacheGet('eki_stamp_stations_' + APP_VERSION);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
            renderStations(cached.stations, cached.stampNames, cached.lineNames, cached.orphanStamps);
            return;
        }
    } catch { /* cache miss */ }

    try {
        const [stations, stampData] = await Promise.all([
            fetch('data/stations.json').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
            fetch('data/stamp-stations.json').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        ]);
        const stampNames = {};
        stampData.stations.forEach(s => { if (s.eki_code) stampNames[s.eki_code] = s.name_en || ''; });
        const lineNames = stampData.line_names || {};
        const orphanStamps = stampData.stations.filter(s => !s.eki_code && s.lat && s.lon);
        renderStations(stations, stampNames, lineNames, orphanStamps);
        cacheSet('eki_stamp_stations_' + APP_VERSION, { stations, stampNames, lineNames, orphanStamps, ts: Date.now() }).catch(() => {});
    } catch (err) {
        console.error('loadStations:', err);
        hideLoading();
        showToast('Failed to load stations — check connection and refresh', 5000, 'error');
    }
};
