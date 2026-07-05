---
name: conventions
description: Architecture and coding conventions for adding or modifying Eki Stamp Tracker features — module layout, shared-state rules, security (esc/XSS), naming/i18n precedence, touch and keyboard accessibility, and where tunables/colours live. Use when writing any new code in js/ or css/app.css, adding a UI element, popup, panel, or config value, or reviewing a change for codebase fit. Design of record: docs/REFACTOR-2026-07.md.
---

# Conventions — extend without degrading

## Quick reference

| Decision | Rule |
|---|---|
| New code goes… | in a new or existing ES module in `js/`, one module ≈ one concern (README "Code map" table lists them all) |
| New styles go… | `css/app.css` only (use the `:root` custom properties + z-index scale) |
| Build tooling | **NEVER.** No npm, no bundler, no package.json in the repo |
| Shared mutable state | user data → `state` (`js/state.js`); layer collections + cross-module scalars → `js/registry.js`; everything else → module-local `let` |
| Tunables | `js/config.js`, exported `const`, with a comment saying what the value guards |
| Anything into `innerHTML` | wrap every interpolated value in `esc()` from `js/registry.js` |
| User-facing names | curated-precedence + `state.lang`-aware + rebuilt on toggle (below) |
| Tooling/CI access to app internals | `window.__eki` (set in `js/main.js`) — extend it, never reshape it |

## Module architecture (from `docs/REFACTOR-2026-07.md`)

- **No build step, ever.** A bundler was explicitly rejected: it would reintroduce
  a toolchain/lockfile/deploy pipeline for zero user-visible gain; GitHub Pages
  serves native ES modules fine. Consequence: `file://` doesn't work — serve with
  `python3 -m http.server 8000`.
- **Shared state has exactly three homes:**
  - user progress on `state` (see the `state-and-sync` skill);
  - layer **collections** (`markers`, `linesByName`, `allLineSegs`, `lineGeomCache`,
    `rideOverlays`, …) as exported `const`s in `js/registry.js`, mutated in place;
  - cross-module **scalars** on the exported `ui` object in `js/registry.js`
    (`ui.map`, `ui.linesReady`, `ui.rideEdit`, `ui.currentPopupMarker`, …) — because
    an imported `let` binding can be read but never assigned by the importer.
    A scalar only moves onto `ui` when it gains a **second writer module**;
    single-module scalars stay module-local `let`s (`hoveredLine`, `toastTimer`, …).
- **Two import cycles are deliberate** (they mirror the old call graph):
  `notify ↔ gist` (sync error → retry link → `syncToGist`) and `lines ↔ rides`
  (render-complete → overlays; in current code the rides→lines edge routes through
  `js/markers.js` `bringStationsToFront`, so only lines→rides is a direct import).
  They are safe because every cross-edge reference happens inside a function called
  after module evaluation. **NEVER add a top-level cross-module call** into these
  pairs — a top-level read of a cycle partner's binding is a boot-order crash.
  Don't add new cycles.
- **`js/geometry.js` stays pure**: no DOM, no Leaflet, no app state. It currently
  imports nothing; `config.js` (tunables) is the only import it is ever allowed.
  This is what keeps `node --test tests/*.test.mjs` running without a browser.
  Geometry code is heavily tuned — refactors there must be mechanical, proven by
  the audit baseline (see the `release-checklist` skill), not by eyeballing.
- **New module header format** (match it exactly — the `§` numbers map modules back
  to the pre-split single file):

  ```js
  // ── 7b. RIDE SECTIONS ─────────────────────────────────────────────────────
  // One or two lines saying what lives here and any deliberate oddity
  // (e.g. "Runtime-only cycle with gist.js (see gist.js header).").
  ```

- **`window.__eki` contract** (`js/main.js`): currently
  `{ buildLineGeometry, buildRideSegments, linesByName, allLineSegs, ui }`.
  `scripts/audit-ride-gaps.mjs` and CI drive the app through it (module bindings
  are invisible to `page.evaluate`). Add keys when tooling needs more; never
  rename or restructure existing ones.

## Security & UX conventions (each rule has a scar behind it)

- **`esc()` for every HTML string you construct from data** — `innerHTML`,
  attribute values, aria-labels, and equally HTML built for clipboard/export.
  Station/line names come from a **scraped external site**, so an unescaped
  interpolation is stored XSS armed at the next data regen (AUDIT 0.2).
  Prefer `textContent`/`createElement` where practical (see `renderSuggestions`
  in `js/search.js` for the pattern).
- **Curated-name precedence for ANY name-showing UI** (README "Conventions"):
  1. curated Funakiya name, network qualifier stripped ("Toei Subway Nakano-sakaue"
     → "Nakano-sakaue");
  2. for un-curated compounds, directional prefix + curated base (新中野 →
     Shin-Nakano);
  3. ekidata romaji only as last resort.
  ekidata's auto-romaji is frequently garbage (米原 → "Yonehara"). The resolver
  already exists (`resolveEn` inside `loadStations`, `js/markers.js`); reuse the
  resolved `name_en` on station records rather than reimplementing. Common
  lookup: station code (`eki_*`/`fk_*`) → station record is `stationByCode`
  in `js/registry.js` (populated by `loadStations`).
- **Respect `state.lang` and rebuild on toggle.** Primary/secondary name order
  flips with the language (`orderLineNames` in `js/registry.js`, `getDisplayName`
  in `js/markers.js`). Popup content is bound as a *function* so it re-renders on
  open; anything cached (marker `stationName`, visible suggestions) is refreshed
  by the toggle handler in `js/lang.js` — wire new name-caches into it. UI chrome
  stays English by decision (AUDIT 6.7); the toggle switches **names only**.
- **Touch-first, keyboard-accessible.** No hover-only actions — every hover
  behaviour needs a tap equivalent (see `attachLineInteractions` in `js/lines.js`:
  click and mouseover share `highlightLine`). Canvas markers are not
  keyboard-focusable (accepted, documented); panels, modals, and search MUST stay
  keyboard-usable — copy the arrow-key pattern in `setupSearch` (`js/search.js`):
  ↑/↓ wrap, Enter activates, Escape closes, `aria-activedescendant` tracks the
  active option. Modals use the focus-trap in `js/welcome.js`.
- **Safe-area insets for fixed-position UI.** Any new fixed/absolute chrome uses
  `env(safe-area-inset-*)` like `#topbar`/`#session-panel` in `css/app.css` — a
  hard-coded `top: 56px` once overlapped the topbar on notched phones (AUDIT 6.3).
- **Two-step confirm for destructive actions** (`RESET_CONFIRM_MS` in
  `js/config.js`): first tap arms the button (relabel + `confirm-pending` class),
  second tap within the window executes, timer disarms. Never `confirm()`. See
  the reset and import buttons in `js/session.js` for the pattern.

## Tunables & colours

- **Every tunable is an exported `const` in `js/config.js` with a comment stating
  what the value guards** (e.g. `RIDE_ROUTE_MAX_M` — "longer ⇒ data anomaly, don't
  draw it"). No magic numbers in feature modules; no duplicated constants.
- **Official line colours live in `js/line-colors.js`** (`LINE_DATA` + `getLineColor`),
  pure data. **Shinkansen colours come from `data/shinkansen.json` ONLY** — a dead
  duplicate Shinkansen palette in `LINE_DATA` once disagreed with it (東北 `#006B3C`
  vs `#22B14C`; AUDIT 2.4) and was deleted. Don't reintroduce one.

## Checklist before you're done

- [ ] New code is in a `js/` module with the standard header; no build artefacts, no `node_modules`, no `package.json` committed.
- [ ] Shared state went to the right home (`state` / registry collection / `ui` / module-local) and no new top-level cross-module calls exist.
- [ ] Every `innerHTML` interpolation is `esc()`-wrapped.
- [ ] New name-showing UI follows curated precedence, respects `state.lang`, and refreshes on toggle.
- [ ] Works by touch alone AND by keyboard (where the element is focusable); fixed UI uses safe-area insets.
- [ ] New constants are in `js/config.js` with a "what this guards" comment.
- [ ] `node --test tests/*.test.mjs` still passes (proves `geometry.js` stayed pure).
- [ ] Shipping it? Follow the `release-checklist` skill.
