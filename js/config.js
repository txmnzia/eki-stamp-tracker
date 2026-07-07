// ── 2. CONSTANTS ──────────────────────────────────────────────────────────
// All tunables in one place. Values and comments moved verbatim from the old
// single-file app (docs/REFACTOR-2026-07.md describes the split).

export const GIST_PREFIX       = 'eki-stamp-tracker:';
// App version — shown discreetly in the session panel. Bump on every merge
// to main. It is also part of the station-cache key, so each release
// invalidates the 7-day IndexedDB cache and users immediately get fresh data.
export const APP_VERSION       = 'v1.8.0';
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
export const STAMP_ICON_PX     = 26;       // stamp-marker box size; the visual badge scales inside it
export const STAMP_SIZE_FACTOR = 1.4375;   // stamp badge diameter vs the plain-dot diameter at the same
                                    // zoom (ring included). Base was 1.15; bumped +25% (owner request)
                                    // so stamps read a little larger than the plain dots at every zoom.
export const STAMP_MIN_SCALE_TOUCH = 0.625; // touch tap floor (also +25%); only kicks in at zooms where the
                                    // plain dots are hidden anyway (PLAIN_MIN_ZOOM), so consistency holds
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
export const LINE_EDIT_DIM = { weight: 1.2, opacity: 0.12 };  // edit mode spotlight: every line EXCEPT the active
                                    // paint target fades back, so the line you're editing is unmistakably the
                                    // foreground (also fixes the old inversion where an active line read fainter
                                    // than its untouched neighbours)
export const LINE_FOCUS    = { weight: 4,   opacity: 0.85 };  // hovered/tapped line
export const RIDE_OVERLAY  = { weight: 4.5, opacity: 0.95 };  // ridden-stretch overlay (full colour)
export const RIDE_OVERLAY_FOCUS = { weight: 6.5, opacity: 1 }; // a ridden line's overlay while it is hovered/focused —
                                    // so a fully-ridden line visibly responds to hover (the overlay used to sit
                                    // inert on top of the focus highlight)
export const RIDE_OVERLAY_DIM = { weight: 2.5, opacity: 0.30 }; // other ridden lines' overlays while one is focused
// Edit-mode painted segments: the RIDDEN and UNRIDDEN styles must be far apart so
// "have I painted this stretch?" reads at a glance (widened from 0.95/w6 vs 0.45/w3,
// which users found too alike). Same hue for both — the gap is weight + opacity.
export const RIDE_SEG_ON   = { weight: 7,   opacity: 1 };     // a stretch you've marked ridden — bold, full colour
export const RIDE_SEG_OFF  = { weight: 2,   opacity: 0.35 };  // not yet ridden — thin, faint
export const PLAIN_EDIT_FILL_OPACITY = 0.5; // non-stamp dots are boosted this opaque (from 0.18) while ride-editing,
                                    // so they work as real landmarks for picking the stretch you rode (#3)
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
// Stamp seal (design A): a hanko-style eki stamp — a FULLY-FILLED disc with a
// thick ring and the kanji 駅 ("station") reading out, no checkmark. One colour:
// the disc is currentColor (grey --marker-idle when uncollected, ink red --ink
// when stamped) and the ring + kanji are drawn in --bg (fully opaque, no
// transparency) so recolouring is a single token change. 駅 is a baked VECTOR
// path (extracted from a JP gothic font) so it needs no font at runtime. Same
// markup serves the map marker and the popup badge — styled in css/app.css
// (`.stamp-glyph` / `.seal-disc` / `.seal-ring` / `.seal-mark`).
export const ICON_STAMP_MARKER  = '<svg class="stamp-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle class="seal-disc" cx="12" cy="12" r="11.3"/><circle class="seal-ring" cx="12" cy="12" r="9.1" fill="none"/><g class="seal-mark" transform="translate(5.81 16.4) scale(0.006 -0.006)"><path d="M1276 825Q1276 532 1249 352Q1210 71 1047 -148L951 -21Q1074 142 1110 389Q1139 583 1139 917V1595H1868V825H1606Q1667 316 1974 30L1882 -113Q1550 208 1473 825ZM1276 956H1731V1464H1276ZM997 743Q981 208 938 13Q916 -77 876 -110Q838 -143 749 -143Q654 -143 553 -131L534 10Q624 -12 706 -12Q789 -12 805 68Q839 221 854 603V628H190V1614H1005V1495H686V1323H946V1210H686V1038H946V925H686V743ZM327 1495V1323H555V1495ZM327 1210V1038H555V1210ZM327 925V743H555V925ZM90 51Q152 250 174 510L278 487Q266 194 205 -31ZM350 70Q350 330 330 485L422 500Q454 316 463 96ZM551 117Q529 334 487 506L571 528Q625 365 653 147ZM729 178Q696 382 639 541L725 571Q792 382 821 217Z"/></g></svg>';
// Route/ride icon: two nodes joined by a path.
export const ICON_RIDE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="19" r="2.4"/><circle cx="19" cy="5" r="2.4"/><path d="M7 17 C 12 12, 9 8, 17 6.5"/></svg>';
