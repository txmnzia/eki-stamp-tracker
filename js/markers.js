// ── 8+9. MARKERS & STATION POPUP ──────────────────────────────────────────
// Marker styles/creation, the station popup HTML, and loadStations (the
// ekidata + stamp-catalogue join that populates the registries).

import { APP_VERSION, CACHE_TTL, IS_TOUCH, POPUP_GRACE_MS, MARKER_BASE_R, MARKER_BASE_R_TOUCH,
         MARKER_ABS_MIN, MARKER_COLL_BONUS, MARKER_MAX_R, ZOOM_BASE, ZOOM_SCALE,
         ICON_STAMP_FILLED, ICON_STAMP_OUTLINE } from './config.js';
import { state } from './state.js';
import { ui, markers, plainMarkers, dedupeMarkers, lineColorMap, lineEnMap, allStations,
         lineGroups, stationByCode, esc, orderLineNames } from './registry.js';
import { cacheGet, cacheSet } from './idb-cache.js';
import { showToast, hideLoading } from './notify.js';
import { updateStats } from './stats.js';

let zoomDebounce;

/** Repaint all station markers on top of lines (they were added first to the canvas). */
// Collected (gold) markers are drawn last so they sit on top of grey ones —
// makes progress easy to see when zoomed out and markers overlap.
export const bringCollectedToFront = () => {
    if (!ui.map) return;
    markers.forEach(m => { if (m._isCollected) m.bringToFront(); });
};

// Re-add markers so they draw above the lines. Stamp markers are restacked every
// call (cheap, ~2.3k); the ~6.7k plain markers are only restacked when asked
// (includePlain, once after lines load) to avoid churning them on every overlay.
export const bringStationsToFront = (includePlain = false) => {
    if (!ui.map) return;
    if (includePlain) plainMarkers.forEach(m => { m.removeFrom(ui.map); m.addTo(ui.map); });
    markers.forEach(m => { m.removeFrom(ui.map); m.addTo(ui.map); });
    bringCollectedToFront();
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

const markerRadius = (collected, zoom) => {
    // Single smooth exponential anchored at the device base size, so dots
    // shrink as you zoom OUT (down to MARKER_ABS_MIN) instead of staying a
    // flat ~8px and merging into one blob over the whole country.
    const base = (IS_TOUCH ? MARKER_BASE_R_TOUCH : MARKER_BASE_R)
                 * Math.pow(ZOOM_SCALE, zoom - ZOOM_BASE);
    const r = Math.min(MARKER_MAX_R, Math.max(MARKER_ABS_MIN, base));
    return collected ? r + MARKER_COLL_BONUS : r;
};

export const circleStyle = (collected, zoom) => collected
    ? { radius: markerRadius(true,  zoom), fillColor: '#f7c948', fillOpacity: 1,    color: 'rgba(247,201,72,0.4)', weight: 2, renderer: ui.canvasRenderer }
    // Uncollected stamp: visible but discreet — soft grey, semi-transparent, no
    // border — so the gold collected markers clearly stand out against them.
    : { radius: markerRadius(false, zoom), fillColor: '#9aa0ac', fillOpacity: 0.5,  color: '#9aa0ac',              weight: 0, renderer: ui.canvasRenderer };

// Non-stamp stations: SAME size as an uncollected stamp dot but much LIGHTER (far
// lower opacity), so they read as "minor station, no stamp" without competing with
// the stamp dots. Still clickable for a name/lines popup.
const plainStyle = (zoom) => ({
    radius: markerRadius(false, zoom),
    fillColor: '#9aa0ac', fillOpacity: 0.18, color: '#9aa0ac', weight: 0, renderer: ui.canvasRenderer,
});
const styleFor = (marker, zoom) => marker._noStamp ? plainStyle(zoom) : circleStyle(marker._isCollected, zoom);

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
        const color = lineColorMap[lc] ?? '#6b6b7a';
        const { primary, secondary } = orderLineNames(lc);
        const label = secondary
            ? `<span class="popup-line-label"><span class="popup-line-jp">${esc(primary)}</span><span class="popup-line-en">${esc(secondary)}</span></span>`
            : `<span class="popup-line-jp">${esc(primary)}</span>`;
        return `<div class="popup-line"><span class="popup-line-dot" style="background:${esc(color)}"></span>${label}</div>`;
    }).join('');

    // Ride edit mode (#17/#18): stations aren't clickable — this popup is purely
    // to identify what's under the cursor. Show just the station name and, if the
    // stamp is already collected, a discreet indicator. No line badges, no button.
    if (ui.rideEdit) {
        const collected = !marker._noStamp && marker._isCollected;
        return `<div class="popup-inner readonly">
            <div class="popup-name">${esc(primary)}</div>
            ${secondary ? `<div class="popup-name-secondary">${esc(secondary)}</div>` : ''}
            ${collected ? `<div class="popup-collected">${ICON_STAMP_FILLED} Stamp collected</div>` : ''}
        </div>`;
    }

    // Normal mode: the collect action shows only for a stamp station. A non-stamp
    // station (#20) never gets a button — just the name + lines, greyed via the
    // `nostamp` class so it's implicit there's nothing to collect here.
    let action = '';
    if (!marker._noStamp) {
        const collected = marker._isCollected;
        const btnIcon   = collected ? ICON_STAMP_FILLED : ICON_STAMP_OUTLINE;
        const btnLabel  = collected ? 'Collected' : 'Collect stamp';
        const btnClass  = 'popup-collect-btn' + (collected ? ' collected' : '');
        const btnAria   = `${collected ? 'Remove stamp' : 'Collect stamp'} for ${primary}`;
        action = `<button class="${btnClass}" aria-label="${esc(btnAria)}">${btnIcon} ${btnLabel}</button>`;
    }

    return `<div class="popup-inner${marker._noStamp ? ' nostamp' : ''}">
        <div class="popup-name">${esc(primary)}</div>
        ${secondary ? `<div class="popup-name-secondary">${esc(secondary)}</div>` : ''}
        ${lineBadges}
        ${action}
    </div>`;
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
    const marker    = L.circleMarker([station.lat, station.lon], plain ? plainStyle(map.getZoom()) : circleStyle(collected, map.getZoom()));

    marker._stationData  = station;
    marker._isCollected  = collected;
    marker._noStamp      = plain;
    marker._lineCodes    = line_code ? [line_code] : [];
    marker.stationName   = getDisplayName(station, code);
    marker.stationNameJP = station.name_kanji || '';
    marker.stationNameEN = getEnName(station, code);

    // Function content so the popup is rebuilt on each open — it then reflects the
    // current stamp state AND whether we're in ride-edit mode (read-only) without
    // having to re-push HTML into thousands of markers.
    marker.bindPopup(() => buildPopupHtml(marker), { offset: L.point(0, -4), closeButton: true, maxWidth: 260 });

    // Click opens popup permanently (no auto-close on mouseout).
    marker.on('click', () => {
        if (ui.suppressTap) { ui.suppressTap = false; return; }   // ignore long-press
        if (ui.rideEdit) return;   // stations aren't clickable while editing a ride
        clearTimeout(marker._popupTimer);
        marker._hoverOpened = false;
        ui.currentPopupMarker = marker;
        marker.openPopup();
    });

    // On desktop, hovering a station opens its popup immediately.
    // Touch devices have no hover — click remains the only trigger.
    if (!IS_TOUCH) {
        marker.on('mouseover', () => {
            clearTimeout(marker._popupTimer);
            marker._hoverOpened = true;
            ui.currentPopupMarker = marker;
            marker.openPopup();
        });

        // When the cursor leaves the marker, schedule the popup to close.
        // If the user moves into the popup HTML (to click Collect), the
        // popup's mouseenter cancels the timer so it stays open.
        marker.on('mouseout', () => {
            if (!marker._hoverOpened) return;
            marker._popupTimer = setTimeout(() => {
                if (marker._hoverOpened && ui.currentPopupMarker === marker) {
                    marker._hoverOpened = false;
                    ui.currentPopupMarker = null;
                    marker.closePopup();
                }
            }, POPUP_GRACE_MS);
        });

        // Attach grace-period handlers to the popup DOM element once it opens.
        // onmouseenter = property assignment avoids accumulating listeners.
        marker.on('popupopen', () => {
            const el = marker.getPopup()?.getElement();
            if (!el) return;
            el.onmouseenter = () => clearTimeout(marker._popupTimer);
            el.onmouseleave = () => {
                if (!marker._hoverOpened) return;
                marker._popupTimer = setTimeout(() => {
                    if (marker._hoverOpened && ui.currentPopupMarker === marker) {
                        marker._hoverOpened = false;
                        ui.currentPopupMarker = null;
                        marker.closePopup();
                    }
                }, POPUP_GRACE_MS);
            };
        });
    }

    // Clear tracking state when popup closes for any reason.
    marker.on('popupclose', () => {
        clearTimeout(marker._popupTimer);
        marker._hoverOpened = false;
        if (ui.currentPopupMarker === marker) ui.currentPopupMarker = null;
    });

    dedupeMarkers[key] = marker;
    (plain ? plainMarkers : markers).push(marker);
    marker.addTo(map);
};
export const refreshAllMarkerStates = () => {
    if (!ui.map) return;
    ui.map.closePopup();
    const zoom = ui.map.getZoom();
    markers.forEach(m => {
        m._isCollected = state.stamps.has(m._stationData.code);
        m.setStyle(circleStyle(m._isCollected, zoom));
        // Popup content is a function (rebuilt on open) — no need to re-push HTML.
    });
    bringCollectedToFront();
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
        // discreet, clickable non-stamp marker. Created BEFORE the stamp passes so
        // the gold/grey stamp dots draw on top of these. Same name resolver so the
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
            clearTimeout(zoomDebounce);
            zoomDebounce = setTimeout(() => {
                const zoom = map.getZoom();
                plainMarkers.forEach(m => m.setStyle(plainStyle(zoom)));
                markers.forEach(m => m.setStyle(circleStyle(m._isCollected, zoom)));
                bringCollectedToFront();
            }, 150);
        });
        bringCollectedToFront();
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
        showToast('Failed to load stations — check connection and refresh', 5000);
    }
};
