// ── 2. CONSTANTS ──────────────────────────────────────────────────────────
// All tunables in one place. Values and comments moved verbatim from the old
// single-file app (docs/REFACTOR-2026-07.md describes the split).

export const GIST_PREFIX       = 'eki-stamp-tracker:';
// App version — shown discreetly in the session panel. Bump on every merge
// to main. It is also part of the station-cache key, so each release
// invalidates the 7-day IndexedDB cache and users immediately get fresh data.
export const APP_VERSION       = 'v1.7.0';
export const CACHE_TTL         = 7 * 24 * 60 * 60 * 1000;  // 7 days
export const BATCH_SIZE        = 150;      // features per animation frame (line rendering)
export const SYNC_DEBOUNCE_MS  = 2000;     // ms after last stamp change before auto-save
export const HOVER_RESET_MS    = 60;       // ms debounce on line mouseout
export const SEARCH_JUMP_MS    = 300;      // ms before popup opens after search jump
export const FOCUS_DELAY_MS    = 100;      // ms before focusing modal input (after paint)
export const MARKER_BASE_R     = 4;        // plain-dot circle radius at ZOOM_BASE
export const MARKER_ABS_MIN    = 1.4;      // hard floor so dots stay visible but don't blob when zoomed out
export const MARKER_MAX_R      = 18;       // cap radius at high zoom to avoid clutter
export const ZOOM_BASE         = 12;       // zoom at which radius = MARKER_BASE_R (and stamp scale = 1)
export const ZOOM_SCALE        = 1.18;     // radius/scale multiplier per zoom step away from ZOOM_BASE
export const STAMP_ICON_PX     = 26;       // stamp-marker box size; the visual glyph scales inside it
export const STAMP_MIN_SCALE   = 0.35;     // glyph floor when zoomed out (desktop; touch uses a higher
export const STAMP_MIN_SCALE_TOUCH = 0.55; //   floor so the tap target never gets too small)
export const STAMP_MAX_SCALE   = 1.3;      // glyph cap at street zoom
export const STAMP_DBL_MS      = 280;      // click-pair window: two clicks/taps on a stamp within this
                                    // toggle it; a lone click opens the info popup after the window
export const MAX_SUGGESTIONS   = 6;
export const RESET_CONFIRM_MS  = 3000;     // window for second click on destructive action
export const MAX_ZOOM          = 19;       // maximum tile zoom level
export const STAMP_TOGGLE_GUARD_MS = 350;  // ignore a repeat stamp toggle within this window (a triple
                                    // click must not toggle twice)
export const PLAIN_MIN_ZOOM    = 11;       // touch only: hide the ~6.7k non-stamp dots below this
                                    // zoom so they don't bury the stamp targets on phones
                                    // (docs/AUDIT.md F-6); desktop always shows them

// Line prominence (AC0: lines are discreet by default; ridden stretches pop).
export const LINE_BASE     = { weight: 1.5, opacity: 0.20 };  // faint colour tint — default look
export const SHINKANSEN_BASE = { ...LINE_BASE };              // Shinkansen fade exactly like every other line
export const LINE_DIM      = { weight: 1.2, opacity: 0.10 };  // other lines while one is focused
export const LINE_EDIT_SHOW = { weight: 2.4, opacity: 0.75 }; // ALL lines while in (global) edit mode — brought
                                    // forward over the dimmed base map so the network is the clear focus
export const LINE_FOCUS    = { weight: 4,   opacity: 0.85 };  // hovered/tapped line
export const RIDE_OVERLAY  = { weight: 4.5, opacity: 0.95 };  // ridden-stretch overlay (full colour)
export const RIDE_SNAP_M   = 60;           // station must sit this close to the line to *score* a group
export const RIDE_INCLUDE_M = 220;         // once the line is chosen, include its OWN stations this far
                                    // out (tolerates rapid/local alignment offsets; safe because
                                    // only the chosen line's stations are ever considered)
export const RIDE_BBOX_PAD = 0.01;         // ~1.1km bbox padding when gathering candidate stations
export const RIDE_BRIDGE_M = 6000;         // keep chains within 6km of the clicked corridor; drop
                                    // far-away segments that merely SHARE the line name (e.g.
                                    // the Tokyo vs Osaka 山手線). Keeps the clicked corridor only.
export const RIDE_STITCH_M = 850;          // join the line's OWN fragmented chains across data gaps up
                                    // to this size (central-Tokyo track is often labelled under
                                    // another line name, leaving ~500m holes in a continuous line).
export const RIDE_ROUTE_MAX_M = 22000;     // cap a single inter-station track route; longer ⇒ treat as a data
                                    // anomaly (branch terminus threaded into the order / duplicate line
                                    // name spanning regions) and don't draw it.
export const SHK_BRIDGE_M  = 20000;        // Shinkansen: join the line's OWN track fragments across larger
                                    // gaps (tunnels split the bundled geometry into pieces) so a line
                                    // becomes one ordered chain we can slice along.
export const SHK_SNAP_M    = 3500;         // a curated Shinkansen stop is "on real track" if within this of
                                    // the bundled geometry; otherwise that span is a straight connector.
// Touch device detection
export const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;

// SVG icon constants.
// Marker glyph: hand-stamp silhouette (round knob, waisted neck, wide base) —
// matches the classic eki-stamp pictogram; fill comes from CSS currentColor
// so one markup serves both the grey (unstamped) and ink-red (stamped) states.
export const ICON_STAMP_MARKER  = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="4.6" r="3.4"/><path d="M10.2 7.4 C10.6 9.6, 8.6 10.4, 8.6 12.6 L15.4 12.6 C15.4 10.4, 13.4 9.6, 13.8 7.4 Z"/><rect x="4.6" y="12.4" width="14.8" height="8.4" rx="1.8"/></svg>';
// Small stamp glyph for the popup state row.
export const ICON_STAMP_FILLED  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="9" y="2" width="6" height="6" rx="1"/><rect x="3" y="8" width="18" height="10" rx="2"/><rect x="2" y="20" width="20" height="3" rx="1"/></svg>';
export const ICON_STAMP_OUTLINE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="6" rx="1"/><rect x="3" y="8" width="18" height="10" rx="2"/><line x1="2" y1="21.5" x2="22" y2="21.5"/></svg>';
// Route/ride icon: two nodes joined by a path.
export const ICON_RIDE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="19" r="2.4"/><circle cx="19" cy="5" r="2.4"/><path d="M7 17 C 12 12, 9 8, 17 6.5"/></svg>';
