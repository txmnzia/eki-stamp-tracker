---
name: run-and-verify
description: Runs the Eki Stamp Tracker locally and verifies any change end-to-end in a headless/sandbox session — static server, node unit tests, data checks, Playwright-driven interaction smoke (collect stamp, search, language toggle, ride edit), and the window.__eki tooling contract. Use when verifying a change before merge, when asked to "run the app" or screenshot it, when writing browser tooling against window.__eki, or when the app won't load headlessly (blank page, Leaflet undefined, CDN 403s).
---

# Run & verify — the full end-to-end protocol

Verification here is **behavioural**, not code review: the geometry pipeline is
heavily tuned and its correctness is proven by driving the real app
(`docs/REFACTOR-2026-07.md` §2, §7). Never sign off a change on "the diff looks
right".

## Use this skill when

- You changed anything in `js/`, `css/`, `index.html`, `data/`, or `scripts/`
  and need to prove it works before merge.
- You need to drive the app headlessly (Playwright) in a sandbox without CDN access.
- You are writing a new CI/tooling script that reads app internals.

## Quick reference (the 90% path — every command verified in this sandbox)

```bash
cd /home/user/eki-stamp-tracker

# 1. Unit tests (pure geometry). NOTE: `node --test tests/` (the form in the
#    docs) fails with MODULE_NOT_FOUND on this sandbox's node v22; use the glob:
node --test tests/*.test.mjs          # expect: pass 18, fail 0

# 2. Data structural checks (fast, no network):
python3 scripts/check_data.py
# expect: "all data checks passed: 10452 stations, 2411 stamps, 22016 track
#          features, 20718 graph nodes, 8 shinkansen"

# 3. Serve the repo (any free port; examples use 8110, CI uses 8097):
python3 -m http.server 8110 &         # from the repo root; kill it when done

# 4. One-time Playwright setup OUTSIDE the repo (never commit node_modules):
SCRATCH=$(mktemp -d)                  # or your session scratchpad dir
(cd "$SCRATCH" && npm init -y >/dev/null && \
 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-fund playwright leaflet)

# 5. Headless smoke + full audit (both use the same env):
export BASE_URL=http://127.0.0.1:8110
export PW_MODULE="$SCRATCH/node_modules/playwright/index.mjs"
export PW_CHROMIUM=/opt/pw-browsers/chromium
export CDN_LOCAL="$SCRATCH/node_modules/leaflet/dist"
node smoke.mjs                                    # your smoke script (snippet below)
MAX_GAPS=15 node scripts/audit-ride-gaps.mjs      # see the ride-gap-audit skill
```

Total runtime: unit tests <1 s, check_data ~5 s, smoke ~10 s, audit ~10 s.
**Kill the server** before finishing — prefer `kill %1` (a `pkill -f "http.server …"`
pattern can match your own shell's command line and kill it, exit 144).

## Serving: a static server is REQUIRED

The app is native ES modules; browsers refuse to load them over `file://`
(module CORS), and the app `fetch()`es `data/*.json` over HTTP anyway. Any
static server from the repo root works. If several sessions/agents share the
sandbox, pick a distinct port each (check with `pkill -0 -f http.server`).

## Playwright in this sandbox (the parts that bite)

| Fact (verified 2026-07) | Consequence |
|---|---|
| No `package.json`/`node_modules` in the repo — **keep it that way** | install playwright in a temp dir outside the repo; point `PW_MODULE` at its `index.mjs` |
| Chromium is preinstalled at `/opt/pw-browsers` (chromium-1194) | do NOT `npx playwright install` (downloads may be blocked anyway) |
| npm-installed playwright is newer than the bundled browser (wants 1228, "Executable doesn't exist") | always pass `PW_CHROMIUM=/opt/pw-browsers/chromium` as `executablePath` |
| `https://unpkg.com` and `*.basemaps.cartocdn.com` → proxy 403 (blocked) | Leaflet + tiles never load online here → use `CDN_LOCAL` (below) |
| `fonts.googleapis.com` → 200 (reachable) | fonts are fine, but stub them anyway for determinism |
| npm registry works through the proxy | `npm install playwright leaflet` is the supported way to get Leaflet's `dist/` |

**The CDN_LOCAL pattern** (from `scripts/audit-ride-gaps.mjs`, the canonical
implementation): intercept `https://unpkg.com/**` with `page.route` and fulfill
`leaflet.js`/`leaflet.css` from the npm `leaflet` package's `dist/`; fulfill
tile and font requests with empty 200s (geometry and UI logic don't need
pixels). Online (CI, dev laptop) you skip all of this and let the real CDNs
load — the audit script and the snippet below switch on the `CDN_LOCAL` env var.

## The `window.__eki` tooling contract

`js/main.js` sets, at module evaluation (before DOMContentLoaded):

```js
window.__eki = { buildLineGeometry, buildRideSegments, linesByName, allLineSegs, ui };
```

- This is the **public contract for tooling/CI** (`scripts/audit-ride-gaps.mjs`
  drives the whole geometry pipeline through it). Module bindings are invisible
  to `page.evaluate`, so anything a script needs from inside the app MUST be
  exposed here. **Extend it; NEVER reshape or remove fields** — CI and every
  script in `scripts/` break silently otherwise.
- `ui` is the live runtime object from `js/registry.js` (`ui.linesReady`,
  `ui.map`, `ui.rideEdit`, `ui.currentPopupMarker`…).
- Read-only diagnostic escape hatch (verified): inside `page.evaluate`,
  `await import(location.origin + '/js/registry.js')` returns the app's **same
  module instance** (module cache is URL-keyed), so you can inspect internals
  like `rideOverlays` or `markers` without touching the app. For anything a
  script needs *permanently*, extend `__eki` instead.

**The wait idiom (MUST use before touching geometry).** Line features render in
RAF batches over several frames; building geometry mid-render caches an
incomplete graph → phantom gaps (the P1 bug in `docs/AUDIT-2026-07.md` §2.1).
Copy this verbatim (the audit script's stability idiom, plus an explicit
`ui.linesReady` check the audit itself doesn't need):

```js
await page.waitForFunction(
  () => window.__eki && typeof __eki.buildLineGeometry === 'function' && Array.isArray(__eki.allLineSegs),
  null, { timeout: 60000 });
await page.waitForFunction(() => {
  window.__n = window.__n || { last: -1, stable: 0 };
  const n = __eki.allLineSegs.length;
  window.__n.stable = (n === window.__n.last) ? window.__n.stable + 1 : 0;
  window.__n.last = n;
  return __eki.ui.linesReady && window.__n.stable >= 5;
}, null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(500);
```

## The full verification protocol (REFACTOR-2026-07.md §7 — all five, in order)

| # | Check | Command / how | Pass looks like |
|---|---|---|---|
| 1 | Pure unit tests (geometry + search ranking) | `node --test tests/*.test.mjs` | `pass 18, fail 0` |
| 2 | Data structural checks | `python3 scripts/check_data.py` | `all data checks passed: …` |
| 3 | Headless load, zero console errors | snippet below (collect `console`/`pageerror` events) | 0 errors after full settle |
| 4 | Interaction smoke | search→jump; collect stamp→toast+ink-red glyph+`eki_local_progress` in localStorage, persists across reload; language toggle (`<html lang="ja">`, button 日本語); line click→popup→`.popup-line-ride-btn`→paint→`#ride-edit-close`→"Ride changes saved" toast+overlay | every step observable |
| 5 | Ride-gap audit at baseline | `MAX_GAPS=15 node scripts/audit-ride-gaps.mjs` | `… 15 gaps total`, exit 0 — see the **ride-gap-audit** skill |

Interaction selectors that matter: `#stationSearch` + `.suggestion-item`,
`.stamp-marker` (DOM stamp-glyph markers — DOUBLE click/tap toggles the
stamp; grey→ink-red via the `stamped` class), `.popup-collect-btn` (the
Stamped/Not stamped row inside the click popup — single-click toggle, the
keyboard path), `#lang-toggle`, `.popup-line-ride-btn`, `#ride-edit-close`,
`#toast`. Since v1.6 there is NO welcome modal and no `#modal-skip`. A lone
click on a stamp marker opens its popup only after the ~280 ms click-pair
window (`STAMP_DBL_MS`), so scripts should waitForSelector after a single
click. Hover = name tooltip (`.line-tooltip`), never a popup. Stamps/rides persist in localStorage key
`eki_local_progress` (see the **state-and-sync** skill).

## Minimal smoke snippet (run successfully here; adapt, don't trust blindly)

```js
// smoke.mjs — env: BASE_URL, PW_MODULE, PW_CHROMIUM, CDN_LOCAL
const pw = await import(process.env.PW_MODULE || 'playwright');
const chromium = pw.chromium || pw.default?.chromium;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
if (process.env.CDN_LOCAL) {              // offline sandbox: local Leaflet, stub tiles/fonts
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  await page.route('https://unpkg.com/**', (route) => {
    const url = route.request().url();
    const file = url.endsWith('.css') ? 'leaflet.css' : url.endsWith('.js') ? 'leaflet.js' : null;
    if (!file) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: file.endsWith('.css') ? 'text/css' : 'application/javascript',
                    body: readFileSync(join(process.env.CDN_LOCAL, file)) });
  });
  await page.route(/https:\/\/(fonts\.(googleapis|gstatic)\.com|[a-d]\.basemaps\.cartocdn\.com)\/.*/,
    (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
}
await page.goto((process.env.BASE_URL || 'http://127.0.0.1:8110') + '/index.html', { waitUntil: 'load' });
// (no welcome modal since v1.6 — the map loads directly)
/* … paste the wait idiom from above here … */
await page.fill('#stationSearch', 'Shinjuku');
await page.waitForSelector('.suggestion-item');
await page.click('.suggestion-item');     // flies to the marker, opens its popup
await page.waitForSelector('.popup-collect-btn');
await page.click('.popup-collect-btn');
await page.waitForFunction(() => document.getElementById('toast').textContent.includes('stamped'));
const code = await page.evaluate(() => __eki.ui.currentPopupMarker._stationData.code);
const saved = await page.evaluate((c) =>
  JSON.parse(localStorage.getItem('eki_local_progress') || '{}').stamps?.includes(c), code);
console.log(saved ? `ok collect+persist ${code}` : 'FAIL persistence', '| console errors:', errors.length);
await browser.close();
process.exit(saved && errors.length === 0 ? 0 : 1);
```

Verified output: `ok collect+persist eki_2200701 | console errors: 0` (~7 s).
For the ride-edit leg: click a screen point on a line (compute it via
`ui.map.latLngToContainerPoint` on a vertex from `__eki.linesByName[name]`),
then `.popup-line-ride-btn`, then paint and `#ride-edit-close` to save. Painting
gotchas (each cost a real debugging cycle):
- The **initial `pointerdown` must land ON the line** (within the hit radius,
  14 px desktop / 24 px touch) — `rideHitTest` in `js/ride-edit.js` bails
  otherwise and the whole drag is a silent no-op that pans the map instead.
  Dragging *through* the line from an off-line start paints nothing.
- The "Ride changes saved" toast only fires if painting set `ui.rideEdit.dirty`
  — its absence after close means your press missed the line, not that saving
  is broken.
- Proof of a saved ride is `eki_local_progress`.rides in localStorage, NOT a
  key in `rideOverlays` (an empty `rideOverlays[name]` entry exists for any
  rendered line).

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `node --test tests/` → `Cannot find module …/tests` | node v22 here rejects the bare directory arg | use `node --test tests/*.test.mjs` (what CI runs) |
| `Executable doesn't exist at …chromium_headless_shell-1228…` | npm playwright newer than preinstalled browsers | `PW_CHROMIUM=/opt/pw-browsers/chromium` |
| Blank page, `L is not defined`, page hangs on load | unpkg blocked by the proxy (CONNECT 403) | set `CDN_LOCAL` to the npm leaflet `dist/` dir |
| Phantom ride gaps / wrong overlays in your script | geometry touched before rendering settled | use the wait idiom; never poll less than 5 stable ticks |
| "Lines are still loading — try again in a moment." toast | `enterRideEditMode` called before `ui.linesReady` | wait for `__eki.ui.linesReady` first (it's a guard, not a bug) |
| `EADDRINUSE` on 8110 | a previous server still running | kill only the exact port (`pkill -f "http.server 8110"` — a broader pattern can kill other sessions' servers), or pick another port |
| node_modules appears in `git status` | playwright installed inside the repo | delete it; only `__pycache__/` is gitignored — install outside the repo |

## Checklist before you're done

- [ ] `node --test tests/*.test.mjs` → 18 pass
- [ ] `python3 scripts/check_data.py` → all checks passed
- [ ] Headless load with **zero** console/page errors after full settle
- [ ] Interaction smoke: collect+reload-persist, search, lang toggle, ride edit→save→overlay
- [ ] `MAX_GAPS=15 node scripts/audit-ride-gaps.mjs` → exactly 15 gaps, exit 0 (**ride-gap-audit** skill)
- [ ] Every server/browser you started is killed; no `node_modules`/`package.json` left in the repo
