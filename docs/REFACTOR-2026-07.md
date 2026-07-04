# Refactor design — from single-file app to no-build ES modules (July 2026)

Design of record for splitting `index.html` (3,365 lines: markup + ~360 lines
CSS + ~2,850 lines JS) into native ES modules. **No build step, no npm, no
bundler, no hosting change** — the app must keep working on GitHub Pages / any
static file server, exactly as before.

---

## 1. Why refactor at all

The single file was a deliberate convention and the code inside it is
disciplined (numbered sections, no accidental globals). It is a well-kept
monolith — but it has crossed the size where the monolith itself is the
biggest source of risk:

1. **The geometry engine is untestable.** ~900 lines of subtle computational
   geometry (`stitchChains`, `bridgeChains`, the Dijkstra in `trackBetween`,
   the corridor/backbone merge in `buildLineGeometry`) can only be exercised
   by driving the whole app in a browser (`scripts/audit-ride-gaps.mjs`,
   minutes per run). Pure functions locked in an inline script can't have
   unit tests.
2. **One blast radius.** A CSS tweak and a routing change diff the same file;
   every change reads as "index.html changed". The v1.4.0 remediation
   (2026-07 audit) churned dozens of unrelated concerns through one file.
3. **~520 lines are pure data** — the `LINE_DATA` colour table — inflating
   the code file and dominating its diff noise.
4. The repo outgrew single-file-ness everywhere else (`scripts/`, `data/`,
   `docs/`, CI). The README's hand-maintained "code map" table is a
   substitute for a real module structure.

**Why native ES modules and not a bundler:** GitHub Pages serves static files
with correct MIME types; `<script type="module">` works everywhere Leaflet
1.9 works. A bundler (Vite etc.) would reintroduce a toolchain, an npm
lockfile, and a build-deploy workflow for zero user-visible gain at this
app's size. The extra HTTP requests (~18 small JS files, HTTP/2) are noise
next to the 15 MB GeoJSON.

**Known cost:** `file://` no longer works at all (module CORS). The README
already recommended a static server because `fetch()` of the data files was
blocked on `file://` anyway; this is now a hard requirement, documented.

## 2. Ground rules for the split

- **Mechanical move-only.** No logic changes, no renames of functions, no
  "improvements while we're here". The geometry code is heavily tuned; the
  only acceptable diffs inside a function body are the shared-scalar renames
  in §4 below.
- **One module ≈ one numbered section** of the old file, so any module can be
  diffed against its old section. The section numbers stay in the header
  comments.
- **Verification is behavioural equivalence**, not code review: the CI
  ride-gap audit drives the real geometry pipeline end-to-end and must report
  exactly the accepted 15-gap baseline, and interaction smoke tests must pass
  (collect stamp, search, language toggle, ride edit, reload persistence).

## 3. Target layout

```
index.html            markup only (+ <link css/app.css>, Leaflet CDN, <script type="module" src="js/main.js">)
css/app.css           all styles, verbatim
js/
  config.js           §2  constants, tunables, prominence styles, SVG icons
  line-colors.js      §1  LINE_DATA + fallback palette + getLineColor/getLineEn (pure data)
  state.js            §3a user-progress state, sanitizeRides, persistLocal, setState, token get/set
  registry.js         §3b shared layer collections + `ui` runtime scalars + esc() + orderLineNames()
  gist.js             §4  apiFetch, findGistId, loadFromGist, syncToGist, scheduleSave
  notify.js           §5  showToast, setSyncStatus, hideLoading
  map-setup.js        §6  initMap, touch gestures
  idb-cache.js        §6b IndexedDB cache (cacheGet/cacheSet/cachePrune)
  geometry.js         §7p PURE geometry: projToSeg, stitchChains, bridgeChains, describeChain,
                          snapOnChain/snapToChains, chainProj, sliceVerts, shinkansenSmooth,
                          mPerDeg, ptDist, bboxGap, distToBbox, seedBucket   ← unit-tested
  line-geometry.js    §7g app geometry: shinkansenPath (+pool/borrowSlice), buildLineGeometry,
                          buildLineGraph, trackBetween, buildRideSegments, snappedPoint
  lines.js            §7  line rendering, hover/highlight, line popup, drawShinkansen, loadLines
  rides.js            §7b ride overlays + saved-ride key migration
  ride-edit.js        §7c on-map ride edit mode
  markers.js          §8+9 marker styles/creation, station popup, loadStations
  search.js           §10 search + suggestions
  lang.js             §11 language toggle
  stats.js            §12 stats bar / progress
  session.js          §13 session panel (load/save/import/export/reset/token)
  welcome.js          §14 welcome modal
  main.js             §15 init, popup-button event delegation, window.__eki test hook
tests/
  geometry.test.mjs   node:test unit tests for geometry.js (runs in CI, no browser)
```

`geometry.js` is the point of the exercise: it must import **nothing but
`config.js`** (for tunables) — no Leaflet, no DOM, no app state — so it runs
under plain `node --test`.

## 4. Shared mutable state

The old script shared two kinds of state across sections; modules make that
explicit:

- **User data** stays on the exported `state` object (`state.js`) — unchanged.
- **Layer collections** (`markers`, `linesByName`, `allLineSegs`,
  `lineGeomCache`, `rideOverlays`, `shinkansenData/Geo`, `stationByCode`,
  `allStations`, `lineGroups`, `lineColorMap`, `lineEnMap`, …) are exported
  `const` objects/arrays from `registry.js`, mutated in place — reference
  semantics identical to before.
- **Cross-module scalars** can't stay as bare `let`s (importers can read but
  never assign an imported binding), so the ones written from more than one
  module move onto an exported `ui` object in `registry.js`:
  `ui.map`, `ui.canvasRenderer`, `ui.linesReady`, `ui.suppressTap`,
  `ui.currentPopupMarker`, `ui.currentPopupLine`, `ui.linePopupSeed`,
  `ui.rideEdit`. This is the **only** rename applied inside function bodies.
  Scalars used by a single module (`hoveredLine`, `hoverTimer`,
  `zoomDebounce`, `toastTimer`, `shinkansenPool`, confirm timers) stay
  module-local `let`s.
- `syncDebounce`/`syncDirty` stay private to `gist.js`; the session panel's
  two uses go through new one-line helpers `isSyncDirty()` and
  `cancelPendingSync()` (the only new functions introduced).

**Import cycles** exist and are deliberate, mirroring the old call graph:
`lines ↔ rides` (render-complete → overlays; overlays → restack markers) and
`notify ↔ gist` (sync error → retry link → syncToGist). Both are safe because
every cross-edge reference happens inside a function called after all modules
are evaluated — no top-level cross-reads. Do not add top-level cross-module
*calls* to these pairs.

## 5. The CI audit contract (`window.__eki`)

`scripts/audit-ride-gaps.mjs` used to reach into the app's global script
bindings from `page.evaluate` (`buildLineGeometry`, `buildRideSegments`,
`linesByName`, `allLineSegs`). Module top-level bindings are invisible to
evaluated scripts, so `main.js` now exposes an explicit, documented test
hook:

```js
window.__eki = { buildLineGeometry, buildRideSegments, linesByName, allLineSegs };
```

The audit script is updated to read through `window.__eki`. This hook is the
**public contract for tooling** — keep it stable, extend it rather than
reshaping it.

## 6. Behaviour notes (why nothing changes at runtime)

- Module scripts are deferred and strict-mode. The old script attached its
  init to `DOMContentLoaded`, which fires *after* deferred scripts run, so
  the listener still works unchanged. The code base was already
  strict-mode-clean (all `const`/`let`, no implicit globals, no `with`).
- Leaflet stays a classic CDN `<script>` in `<head>`; it executes before any
  module, so the global `L` is always available.
- All asset paths stay relative (`css/…`, `js/…`, `data/…`), so the app works
  under a GitHub Pages project subpath exactly as before.
- `APP_VERSION` bumps to v1.5.0 (in-code convention: bump on every merge to
  main); data files are untouched.

## 7. Verification (all must pass before merge)

1. `node --test tests/` — pure-geometry unit tests.
2. `python3 scripts/check_data.py` — unchanged, still green.
3. Headless Chromium loads the served app with **zero console errors**;
   screenshot sanity check.
4. Interaction smoke via Playwright: collect a stamp → toast + gold marker +
   localStorage persists across reload; search + jump; language toggle;
   line popup → ride edit mode → paint → save → overlay drawn.
5. `scripts/audit-ride-gaps.mjs` against the refactored app reports **exactly
   the accepted 15-gap baseline** — this exercises stitching, corridor
   filtering, station merging, graph routing, and Shinkansen pathing across
   all ~590 lines, i.e. behavioural equivalence of the entire geometry
   pipeline.

## 8. Out of scope

Deliberately not done here (candidates for later, now cheap because modules
exist): TypeScript/JSDoc types, further unit tests over `line-geometry.js`
with fixture data, moving `LINE_DATA` into `data/` as JSON, a service worker
for offline tiles.
