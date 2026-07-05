---
name: ride-gap-audit
description: Runs and interprets scripts/audit-ride-gaps.mjs — the project's ground-truth regression gate for the ride/track geometry pipeline (stitching, corridor filtering, station merging, graph routing, Shinkansen pathing). Use before merging any change to js/geometry.js, js/line-geometry.js, js/lines.js, data/railroad-section.geojson, data/stations.json, or scripts/; when CI's data-audit ride-gaps job fails; when a ride overlay shows a gap or wrong routing; or when tempted to "fix" a gap seen in one screenshot.
---

# Ride-gap audit — the geometry pipeline's regression gate

## Use this skill when

- Any change touches geometry code, line rendering, or shipped track/station data.
- The CI `ride-gaps` job (`.github/workflows/data-audit.yml`) fails.
- A user-visible ride overlay has a gap — **never chase gaps one screenshot at a
  time**: the audit drives the *real app* (same `buildLineGeometry` /
  `buildRideSegments`, via `window.__eki` — no reimplementation that can drift)
  and lists every line's remaining gaps at once, classified. One run replaces an
  afternoon of screenshots and tells you whether the gap is yours or the data's.

## What it measures

For every drawn line (582 currently), it builds the line's geometry seeded at
its own track centroid, builds the ride segments, and reports every pair of
ekidata-adjacent stations the track graph could NOT connect:

| Class | Meaning | Typical action |
|---|---|---|
| `HOLE` | no geojson track within ~800 m of the straight line — the **base map line is gapped there too**; a genuine data hole | leave it (baseline) or fix the source geojson; NEVER paint over it |
| `SPLIT-TRACK` | track exists nearby but the graph route was absent or longer than `RIDE_ROUTE_MAX_M` (22 km, `js/config.js`) — a data anomaly | corridor/station-order or relabelling fix (see below) |

**MUST-know invariant:** the overlay only slices existing drawn track vertices.
A gap in the geojson stays a gap. NEVER "fix" a gap with an invented straight
connector — an earlier version did, and drew bogus diagonals across bare-name
corridors like `本線` that merge 京成/相鉄/京急 (README "Ride gaps" section).

## Quick reference

**Sandbox invocation (verified end-to-end here, ~10 s, exit 0):**

```bash
cd /home/user/eki-stamp-tracker
python3 -m http.server 8110 &                 # any free port; kill it when done

SCRATCH=$(mktemp -d)                          # outside the repo; never commit node_modules
(cd "$SCRATCH" && npm init -y >/dev/null && \
 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-fund playwright leaflet)

BASE_URL=http://127.0.0.1:8110 \
PW_MODULE="$SCRATCH/node_modules/playwright/index.mjs" \
PW_CHROMIUM=/opt/pw-browsers/chromium \
CDN_LOCAL="$SCRATCH/node_modules/leaflet/dist" \
MAX_GAPS=15 node scripts/audit-ride-gaps.mjs
```

`CDN_LOCAL` is required in this sandbox: unpkg and CARTO are blocked by the
proxy (CONNECT 403), so the script serves Leaflet from the npm package's
`dist/` and stubs tiles/fonts (geometry needs no pixels). `PW_CHROMIUM` is
required because npm's playwright is newer than the preinstalled
`/opt/pw-browsers` chromium-1194. Details: **run-and-verify** skill.

**Online / CI invocation** (what `.github/workflows/data-audit.yml` runs;
needs real CDN access, so it does NOT work in this sandbox):

```bash
npm init -y && npm install playwright && npx playwright install --with-deps chromium
python3 -m http.server 8097 &
BASE_URL=http://127.0.0.1:8097 MAX_GAPS=15 node scripts/audit-ride-gaps.mjs
```

**Runtime:** ~10 s in this sandbox; the CI job has a 15-minute timeout (browser
install dominates). If it hangs >60 s it is almost always the CDN problem, not
the geometry.

**Verified baseline output (2026-07, v1.5.0):**

```
ride-gap audit — 582 lines, 10 with gaps, 15 gaps total
```

with exactly these lines: 成田線 (SPLIT-TRACK 72 km Matsugishi→Abiko — the
Abiko-branch station-order anomaly), 予讃線 ×5 HOLE (Shimonada coastal loop +
Uchiko spans), JR神戸線(神戸～姫路) HOLE, 筑肥線 SPLIT-TRACK (Yamamoto branch),
JR関西空港線 HOLE, 上越線 ×2 SPLIT-TRACK (Echigo-Yuzawa/Gala area), 東武日光線
HOLE, おおさか東線, 富山地鉄本線, 京急本線 (Yokohama) — small SPLIT-TRACK seams
where the homonym split exposed a corridor span labelled under another name.
These are documented in the README's "Ride gaps (chain holes) and the audit"
section.

## MAX_GAPS baseline discipline

- The baseline lives in **`.github/workflows/data-audit.yml`** (`MAX_GAPS: '15'`)
  and means: 15 **known-genuine data holes**, individually understood and listed
  above / in the README. The script's own default is `MAX_GAPS=0` (exit 1 on any
  gap), so always pass `MAX_GAPS=15` for a baseline comparison.
- **A NEW gap (total >15) after a code change means your change is wrong.**
  Geometry refactors must be mechanical and prove behavioural equivalence by
  reporting *exactly* the baseline (REFACTOR-2026-07.md §2, §7.5) — not "still
  only a few gaps". A total <15 after a pure refactor is ALSO a red flag:
  investigate what started connecting that shouldn't.
- The baseline may change **only** on a deliberate data ship (refreshed geojson,
  corridor/relabelling fix, new curated line) where you can name each gap that
  appeared/disappeared and why. In that PR: update `MAX_GAPS` in the workflow,
  update the README's gap list, bump `APP_VERSION` (**release-checklist** skill).
- NEVER bump `MAX_GAPS` to make a red build green.

## The mid-render trap (do not delete either guard)

Line features render in RAF batches over several frames (22k features). Building
geometry before rendering settles caches an **incomplete graph** in
`lineGeomCache` → phantom gaps and corrupted overlays until a full reload. This
was the P1 bug in `docs/AUDIT-2026-07.md` §2.1. Two guards exist; both are
load-bearing:

- The audit script waits for `window.__eki` and then for `allLineSegs.length`
  to be **stable for 5 polls** before evaluating anything (`audit-ride-gaps.mjs`
  — copy that idiom into any new tooling; it is reproduced in the
  **run-and-verify** skill).
- The app itself gates on `ui.linesReady` (`js/registry.js`; set in `js/lines.js`
  at render completion): `renderRideOverlays` in `js/rides.js` returns early and
  `enterRideEditMode` in `js/ride-edit.js` refuses to start until it is true.

Deleting either one reintroduces the bug — in the app for returning users whose
gist loads mid-render, and in tooling as false audit failures.

## Acting on each class of new gap

| Finding | Diagnosis | Correct fix |
|---|---|---|
| New `SPLIT-TRACK`, small divergence (≤ ~300 m) | corridor span labelled under a different `路線名`, or station order anomaly | relabel in the geojson (`scripts/disambiguate_geojson_lines.py` pattern) or fix the station list/corridor logic |
| New `SPLIT-TRACK`, huge distance (tens of km) | branch terminus threaded into the trunk's ordered list (成田線-style), or a bare name merging unrelated railways | split/disambiguate the line name, or accept+document as baseline |
| New `HOLE` | the geojson genuinely lacks track there | fix upstream data or accept into the baseline with README entry; **NEVER a faked straight line** |
| Many new gaps at once, spread across lines | you built geometry mid-render, broke the wait/`linesReady` guard, or changed a tunable (`RIDE_*_M` in `js/config.js`) | revert; re-run; the tunables are heavily tuned — mechanical refactors only |
| Fewer gaps than baseline after a code-only change | something started bridging that must not (invented connectors?) | treat as a failure; inspect the lines that "healed" |

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| exit 1 with `15 gaps total` | `MAX_GAPS` unset (default 0) | pass `MAX_GAPS=15` |
| `Executable doesn't exist at …1228…` | playwright/browser version mismatch | `PW_CHROMIUM=/opt/pw-browsers/chromium` |
| Timeout waiting for `window.__eki` | unpkg blocked → Leaflet never loads → app never boots | set `CDN_LOCAL`; or server not running / wrong `BASE_URL` |
| `Cannot find module 'playwright'` | script run outside an npm dir | point `PW_MODULE` at the installed `…/playwright/index.mjs` |
| Gap counts vary between runs | stabilisation wait removed/shortened | restore the 5-stable-polls idiom |
| CI fails only on your PR, audit green locally | you tested against stale local data or forgot to commit a data file | re-run on a clean checkout of the branch |

## Checklist before you're done

- [ ] Audit run to completion (all 582 lines), not aborted early
- [ ] Total is exactly the baseline (15) — or every delta is named and explained in the PR
- [ ] If baseline changed: `MAX_GAPS` in `.github/workflows/data-audit.yml` + README gap list updated, `APP_VERSION` bumped
- [ ] No invented connectors anywhere — a `HOLE` stayed a hole
- [ ] The wait idiom and `ui.linesReady` gate are intact
- [ ] Server killed; no `node_modules`/`package.json` left in the repo
