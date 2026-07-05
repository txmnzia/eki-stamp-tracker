---
name: geometry-pipeline
description: Mental model and debugging guide for the ride/line geometry engine (js/geometry.js, js/line-geometry.js) — the stitch → corridor → backbone-merge → bridge → route pipeline, its tunables, and the Shinkansen exception. Use when ride overlays show gaps or wrong routing, a line's station list is wrong/misordered, buildLineGeometry/trackBetween/buildRideSegments behave unexpectedly, the ride-gap audit baseline moves off 15, or you are asked to change anything in js/geometry.js, js/line-geometry.js, or the RIDE_*/SHK_* tunables in js/config.js.
---

# Ride/line geometry engine

The most subtle code in the repo. It is **heavily tuned**: mechanical refactors
only, and behavioural equivalence is proven by the audit baseline (**exactly 15
gaps**, see below) — never by eyeballing screenshots. Background: README
"Ride sections" + "Ride gaps"; `docs/HANDOVER-line-highlight.md` for why the
design is what it is.

## Use this skill when

- A ride overlay has a gap, a detour, or paints the wrong region.
- A line's ride picker lists wrong/missing/misordered stations.
- You're touching `js/geometry.js`, `js/line-geometry.js`, or `RIDE_*`/`SHK_*`
  in `js/config.js`.
- CI's ride-gap audit reports more (or fewer!) than 15 gaps.

## Quick reference — the 5-step pipeline

`buildLineGeometry(name, seed)` in `js/line-geometry.js` (lazy, cached in
`registry.js` `lineGeomCache`, key = `name + '|' + seedBucket(seed)`):

| # | Step | Owner | What it does |
|---|------|-------|--------------|
| 1 | **Stitch** | `stitchChains` + `bridgeChains(raw, RIDE_STITCH_M)` — pure `js/geometry.js` | Join the line's unordered geojson segments into ordered chains by coincident endpoints (5-dp key), then merge a continuous line's own fragments across ≤850 m data holes |
| 2 | **Corridor filter** | inside `buildLineGeometry` | From the chain nearest the click `seed`, transitively keep chains within `RIDE_BRIDGE_M` (bbox gap); DROP far same-name regions (Tokyo vs Osaka 山手線). Filters what's kept as `chains`; the unfiltered set survives as `allChains` |
| 3 | **Backbone merge** | inside `buildLineGeometry` | Station list from ekidata's ordered groups (`registry.js` `lineGroups`), NOT proximity: richest on-corridor group = backbone; other corridor groups' extra stops (tight `RIDE_SNAP_M` snap, ≥3 hits) inserted into the least-detour backbone edge. Proximity fallback only for lines absent from ekidata |
| 4 | **Bridge own chains** | step 1's `bridgeChains` call | (Conceptually step 4 in the README; implemented as part of stitching.) Central-Tokyo track is often relabelled under another line name, leaving ~500 m holes — sub-`RIDE_STITCH_M` joins close them |
| 5 | **Slice/route existing vertices only** | `buildLineGraph` + `trackBetween` + `buildRideSegments` (`js/line-geometry.js`); render via `js/rides.js` `renderRideOverlays` | One segment per consecutive station pair: same chain → `sliceVerts`; different chains → Dijkstra over the vertex graph of **allChains**. No path or > `RIDE_ROUTE_MAX_M` → segment dropped (null), never bridged |

Pure algorithms (`stitchChains`, `bridgeChains`, `describeChain`, `snapOnChain`,
`snapToChains`, `chainProj`, `sliceVerts`, `projToSeg`, `ptDist`, `bboxGap`,
`distToBbox`, `seedBucket`, `shinkansenSmooth`) live in `js/geometry.js`, which
imports NOTHING (no DOM/Leaflet/state) so `node --test` can run it. Keep it that way.

## Tunables (`js/config.js`) — what each guards

| Constant | Value | Guards |
|---|---|---|
| `RIDE_SNAP_M` | 60 | how close a station must sit to the corridor to *score* its ekidata group / qualify as a mergeable extra stop. Raise it and perpendicular crossing lines start donating stations |
| `RIDE_INCLUDE_M` | 220 | once a group is chosen, include its OWN stations this far out (rapid/local alignment offsets). Safe only because it applies to the chosen line's stations |
| `RIDE_BBOX_PAD` | 0.01° | bbox pre-filter when gathering candidate stations (perf) |
| `RIDE_BRIDGE_M` | 6000 | corridor connectivity: chains further than this from the kept set are a *different region* sharing the name |
| `RIDE_STITCH_M` | 850 | max data hole `bridgeChains` may close inside one continuous line. Bigger and you start welding unrelated railways in bare-name corridors |
| `RIDE_ROUTE_MAX_M` | 22000 | cap on a cross-chain graph route; longer = data anomaly (branch terminus threaded into the order), drop the segment. Same-chain slices are deliberately NOT capped (Shinkansen stops are 50–60 km apart on one chain — see comment in `trackBetween`) |
| `SHK_BRIDGE_M` | 20000 | Shinkansen own-fragment joining (tunnels split the geometry into big pieces) |
| `SHK_SNAP_M` | 3500 | a curated Shinkansen stop counts as "on real track" within this distance |

## Non-negotiable invariants (delete a guard here and CI or users pay)

- **NEVER invent straight connectors.** Ride overlays only slice existing drawn
  track vertices; a geojson gap stays a gap. An earlier version drew straight
  bridges and painted bogus diagonals across bare-name corridors like 本線
  (merging 京成/相鉄/京急). `buildRideSegments` returning fewer segments than
  station pairs is by design.
- **The graph routes over `allChains` (pre-corridor-filter), the corridor
  filter only limits which STATIONS are listed.** `buildLineGraph` uses
  `geom.allChains`; keying vertices by rounded coordinate reconnects junctions
  so a ride follows the real drawn line across chain boundaries. Far
  duplicate-name regions stay separate graph components (can't be routed into);
  `RIDE_ROUTE_MAX_M` catches strays. Route on `chains` instead and rides break
  at every chain seam the base map draws through.
- **`linesReady` gate + cache discipline.** Building/caching geometry while
  line features are still RAF-batch rendering poisons `lineGeomCache` with a
  partial graph → phantom gaps all session (AUDIT 2026-07 finding 2.1).
  `renderRideOverlays` and `enterRideEditMode` bail unless `ui.linesReady`;
  `onLinesReady` in `js/lines.js` clears `lineGeomCache` before the first real
  build. Any new caller of `buildLineGeometry` MUST check `ui.linesReady` first.
- **Mechanical refactors only.** The constants and heuristics (≥3-hit rule,
  0.7–1.7 length-ratio, least-detour insertion) encode fixed regressions.
  Behavioural equivalence = the audit still reports exactly 15 gaps.
- **NEVER join stations↔geometry by name** (measured dead end: 57/390 exact,
  149/390 normalized — handover doc). Geometry decides what to colour, ekidata
  order decides which stations; they meet only spatially.

## The Shinkansen exception (end-to-end)

`stations.json` has no Shinkansen lines, so `data/shinkansen.json` (curated,
built by `scripts/build_shinkansen.py`) supplies each line's ordered stops.
In `buildLineGeometry`, a `shinkansenData[name]` hit short-circuits the whole
pipeline: the line IS its stops; no corridor filter, no backbone merge.

- `shinkansenPath(name)` (`js/line-geometry.js`, cached on `info._path`)
  stitches the line's own geojson fragments (`shinkansenGeo`, captured by
  `renderLines` in `js/lines.js` — names containing 新幹線 are not drawn raw),
  bridges with `SHK_BRIDGE_M`, snaps every stop (`SHK_SNAP_M`), and slices real
  vertices between consecutive on-track stops.
- Gap spans borrow physically-shared track from `buildShinkansenPool()` (all
  Shinkansen fragments pooled — shared corridors like Tokyo–Takasaki are stored
  under whichever line the geojson labelled). `borrowSlice` requires both stops
  on the SAME pooled chain and a sliced length **0.7–1.7× the straight chord** —
  the guard that stops a stitched branch introducing a detour.
- Spans no Shinkansen covers at all (Kanazawa–Tsuruga extension, Seikan tunnel)
  stay straight connectors; a line with no usable geometry at all falls back to
  `shinkansenSmooth` (centripetal Catmull-Rom through the stops).
- Stops are anchor vertices (`anchorIdx`) in the path, so drawn line and ride
  segments share one geometry. Shinkansen-only stations (新富士, 岐阜羽島 — 17
  of them) carry synthetic `shk_*` codes with no stamp linkage.
- **西九州新幹線 has NO track in the bundled geojson** (verified: the only
  西九州* name is the conventional 西九州線) — it draws as the smoothed curve
  until upstream geometry is refreshed. Not a bug.

## Debugging workflow

**Never chase gaps one screenshot at a time.** Reproduce with the audit or a
headless `window.__eki` probe (`window.__eki = { buildLineGeometry,
buildRideSegments, linesByName, allLineSegs, ui }`, set in `js/main.js` — the
public tooling contract; extend, never reshape).

Pure-geometry changes — unit tests (verified in this sandbox; note the
directory form `node --test tests/` fails on some node builds with
MODULE_NOT_FOUND, so name the file):

```sh
cd /path/to/eki-stamp-tracker && node --test tests/geometry.test.mjs   # 10/10 pass
```

Add new fixture-based tests to `tests/geometry.test.mjs` — small synthetic
`[lat,lng]` chains near 35°N, following the existing style. Anything in
`js/line-geometry.js` has no unit tests (needs registries); it is covered by
the audit.

Full audit (verified recipe for THIS sandbox — unpkg is blocked by the proxy,
so `CDN_LOCAL` is mandatory; install playwright+leaflet OUTSIDE the repo):

```sh
cd /path/to/eki-stamp-tracker && python3 -m http.server 8097 &   # serve repo root
mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && npm i playwright leaflet
cd /path/to/eki-stamp-tracker
PW_MODULE=/tmp/pw/node_modules/playwright/index.mjs \
PW_CHROMIUM=/opt/pw-browsers/chromium \
CDN_LOCAL=/tmp/pw/node_modules/leaflet/dist \
BASE_URL=http://127.0.0.1:8097 MAX_GAPS=15 node scripts/audit-ride-gaps.mjs
# expected: "ride-gap audit — 582 lines, 10 with gaps, 15 gaps total", exit 0
```

`PW_CHROMIUM` is required here: the npm playwright expects a newer browser
build than the preinstalled `/opt/pw-browsers` set. Online (CI does this),
plain `npx playwright install --with-deps chromium` + no `CDN_LOCAL` works.

To probe ONE line, copy the audit's setup (routes, `waitForFunction` on
`window.__eki?.ui?.linesReady`, seed = centroid of `linesByName[name]`'s
vertices) and `page.evaluate` `buildLineGeometry` + `buildRideSegments`.
Verified example: `中央線` → 337 polylines, 28 chains, 112 stations, 111
segments. The wait for `linesReady` (or the audit's allLineSegs-stability loop)
is NOT optional — probing early reproduces the mid-render cache bug and reports
false gaps.

**Tuning problem vs data problem:** run the audit and read the class.
`SPLIT-TRACK` (track nearby, route absent/over cap) *might* respond to
corridor/station-list fixes; `HOLE` (base line gapped too) is missing geojson —
no JS change can fix it, only refreshed upstream data. If a gap appears on a
line you didn't touch after a geometry edit, you broke an invariant; diff
against the 15-gap baseline, don't rationalise.

## Known hard cases that are NOT bugs (do not "fix")

| Case | Why it's accepted |
|---|---|
| Central-Tokyo relabelled track | 中央線's Tokyo-station span is labelled under other line names; 東京 doesn't appear in the 中央線 picker (神田/御茶ノ水 do). Handover doc, open problem 1 |
| Parallel rapid/local alignments | Best-fit group is one alignment; a few stops on the other may not snap. Handover, problem 2 |
| 成田線 Abiko branch | ekidata concatenates trunk + branch as one ordered list → a 72 km "adjacent" pair, correctly dropped by `RIDE_ROUTE_MAX_M` as SPLIT-TRACK. AUDIT 4.6 |
| The 15-gap baseline | All genuine: rural geojson holes (予讃線 Shimonada area, 筑肥線 Yamamoto, 上越線 Gala-Yuzawa seams) + homonym-split seams (京急本線 at Yokohama, 富山地鉄本線, おおさか東線). Needs data/relabelling fixes, never a faked line |
| Bare-name corridors staying disconnected | A gap, not a diagonal, is the correct rendering between unrelated railways sharing a 路線名 |

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Phantom gaps everywhere, only for returning users / first load | geometry built before `linesReady`; poisoned `lineGeomCache` | find the caller skipping the `ui.linesReady` check; never remove the cache clear in `onLinesReady` |
| Ride breaks at a chain seam the base line draws through | graph built over `chains` instead of `allChains`, or vertex key precision changed | restore `geom.allChains` in `buildLineGraph`; keys are `toFixed(5)` on BOTH sides (stitch + graph) |
| Overlay jumps to wrong region after session load | corridor seeded wrong | `renderRideOverlays` seeds from saved stations' centroid; check `seedBucket` cache key isn't collapsing two regions |
| Foreign stations in a line's picker | `RIDE_SNAP_M` raised, or ≥3-hit extras rule weakened | restore; the rule exists to ignore perpendicular crossings |
| Long bogus segment drawn across country | `RIDE_ROUTE_MAX_M` cap removed/raised, or applied to same-chain slices (breaks Shinkansen instead) | cap cross-chain routes only, exactly as `trackBetween` comments say |
| Shinkansen line takes a detour through a branch | `borrowSlice` length-ratio guard (0.7–1.7×) loosened | restore the guard |
| Audit reports gaps locally but CI is green (or vice versa) | ran against stale IndexedDB/partial render, or MAX_GAPS mismatch | audit already waits for stability; check `MAX_GAPS=15` and that data/ is unmodified |

## Checklist before you're done

- [ ] `node --test tests/geometry.test.mjs` — 10/10 pass.
- [ ] Ride-gap audit run and reports **exactly 15 gaps** (any delta explained
      and deliberately baselined in `.github/workflows/data-audit.yml`).
- [ ] `js/geometry.js` still imports nothing.
- [ ] No new `buildLineGeometry`/`buildRideSegments` caller skips `ui.linesReady`.
- [ ] `window.__eki` extended, not reshaped, if tooling needed new access.
- [ ] No straight-connector "fix" anywhere; no line-name join anywhere.
