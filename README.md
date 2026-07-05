# Eki Stamp Tracker

An interactive map of Japan for tracking **eki stamps** (駅スタンプ — the rubber
stamps collected at railway stations) and **logging the sections of train lines
you've ridden**.

The app is dependency-light static files — `index.html` + native ES modules in
`js/` + one stylesheet — with **no build step, no npm, no bundler**. Serve the
folder (GitHub Pages or any static server) and it works.

---

## Quick start

```bash
# Any static file server works; the app fetches the JSON/GeoJSON in data/ over HTTP.
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

A static server is **required** (not just recommended): the app is ES modules,
which browsers refuse to load over `file://`, and the data files are fetched
over HTTP anyway.

Runtime dependencies are loaded from CDNs (no npm install needed to run):

- **Leaflet 1.9** (map engine) from unpkg
- **CARTO dark** basemap tiles
- Google Fonts (Zen Kaku Gothic New, Space Mono)

---

## What the app does

1. **Map of stamp stations.** Every station that has a real eki stamp is drawn as
   a circle marker. Tap one to see its name(s) and lines, and a **Collect stamp**
   button. Collected stamps turn gold.
2. **Train lines.** All railway lines are drawn from GeoJSON track geometry. They
   are **faint by default** and brighten on hover/tap.
3. **Ride sections** (independent from stamps). Tap a line → **Add a ride** → pick
   the stretch of stations you rode in a vertical line diagram → that stretch is
   painted onto the map in the line's colour, following the real track. See
   [Ride sections](#ride-sections-feature) below.
4. **Sync.** Progress (stamps *and* rides) is always saved locally
   (`localStorage`). Optionally, the user adds their **own** GitHub token
   (gist scope) in the Session panel and progress also syncs to a private Gist
   on their account, keyed by a chosen "sync name", so it follows them across
   devices. Also importable/exportable as JSON.
5. **Bilingual.** Toggle EN / 日本語 for all station and line names.

---

## File layout

```
index.html                      Markup only; loads css/app.css and js/main.js (type="module")
css/app.css                     All styles
js/                             The app, as native ES modules (see "Code map" below)
tests/geometry.test.mjs         Unit tests for the pure geometry module (node --test)
README.md                       This file
data/
  stations.json                 ekidata: every line with its stations IN ORDER (lat/lon)
  stamp-stations.json           the curated stamp stations (which markers to draw)
  funakiya-lines.json           curated EN/kanji names for lines
  funakiya-stations.json        curated station name data (Funakiya scrape)
  funakiya-raw.json             raw Funakiya scrape (source for the above)
  railroad-section.geojson      track geometry: one LineString per segment, keyed by 路線名
  rail-graph.json               precomputed national routing graph (for future track work)
  shinkansen.json               curated Shinkansen lines (ordered stops + coords)
scripts/
  scrape_funakiya*.py           scrapers for the Funakiya stamp catalogue
  build_stamp_stations.py       builds data/stamp-stations.json
  build_rail_graph.py           builds data/rail-graph.json from the GeoJSON
  build_shinkansen.py           builds data/shinkansen.json (curated Shinkansen stops)
  audit-ride-gaps.mjs           audits EVERY line for ride-overlay gaps (see "Ride gaps")
docs/
  HANDOVER-line-highlight.md    investigation notes on line↔station association
```

### Key data shapes

`stations.json` — array, one entry per line, **stations already in geographic order**:

```jsonc
[{
  "line_name": "JR函館本線(函館～長万部)",
  "line_name_en": "Jrhakodatehonsen(Hakodate~Oshamanbe)",
  "stations": [
    { "code": "eki_1110101", "name_kanji": "函館", "name_en": "Hakodate",
      "lat": 41.773709, "lon": 140.726413, "line_code": "JR函館本線(函館～長万部)" },
    ...
  ]
}]
```

`stamp-stations.json` — the stations that actually have a stamp (drives which
markers appear). `eki_code` joins to a `stations.json` station `code`.

`railroad-section.geojson` — `FeatureCollection`; each feature is a single
`LineString` segment with `properties.路線名` (the line's kanji name). A line is
**many** segments sharing the same `路線名`. Homonymous bare names that merged
unrelated railways (`本線`, `日光線`, `京都線`…) have been **disambiguated to
operator-qualified names** (`京急本線`, `東武日光線`, `近鉄京都線`…) by
`scripts/disambiguate_geojson_lines.py`; re-run it after refreshing the raw
geojson from upstream.

> ⚠️ The line names in `railroad-section.geojson` (`路線名`) and in
> `stations.json` (`line_name`) still **do not match** reliably. Do not join
> them by name — see `docs/HANDOVER-line-highlight.md`.

---

## Code map (`js/`)

The app is native ES modules, one per concern (the old single-file section
numbers survive in the module headers; `docs/REFACTOR-2026-07.md` is the
design of record for the split):

| Module | What lives there |
|---|---|
| `config.js` | tunables: cache TTL, marker sizing, **line prominence styles**, **ride snap distance**, `APP_VERSION` |
| `line-colors.js` | official operator colour table (pure data) + `getLineColor` |
| `state.js` | `state` = `{ lang, user, gistId, stamps:Set, rides:{} }`, `setState`, local-first persistence, token get/set |
| `registry.js` | shared layer collections (`linesByName`, `markers`, caches…) + the `ui` runtime scalars + `esc()` |
| `gist.js` | `loadFromGist`, `syncToGist` (persists stamps **and** rides), `findGistId` |
| `notify.js` | toasts + sync-status indicator |
| `map-setup.js` | Leaflet map, canvas renderer, custom touch gestures |
| `idb-cache.js` | IndexedDB cache (get/set/prune) |
| `geometry.js` | **pure** track geometry (stitching, bridging, projection) — no DOM/Leaflet/state; unit-tested via `node --test tests/*.test.mjs` |
| `line-geometry.js` | corridor building (`buildLineGeometry`), track routing (`trackBetween`), `buildRideSegments`, Shinkansen paths |
| `lines.js` | draws GeoJSON lines (faint by default), hover/tap highlight, **line popup** |
| `rides.js` | **ridden-stretch overlays** + saved-ride key migration (see below) |
| `ride-edit.js` | select ridden stretches **on the map** (handles branches) |
| `markers.js` | builds/merges station markers, station popup, `loadStations` |
| `search.js` / `search-rank.js` / `lang.js` / `stats.js` / `session.js` / `welcome.js` | search UI + **pure** relevance/proximity ranking (unit-tested), language toggle, stats, session panel, welcome modal |
| `main.js` | init, popup-button event delegation, and the **`window.__eki` test hook** that `scripts/audit-ride-gaps.mjs` drives the app through |

State is read via `state.*` and written via `setState(...)` (which persists some
keys to `localStorage`). Map data is cached in **IndexedDB** (`eki-cache`, keyed by
`APP_VERSION`) for ~7 days so repeat loads are fast.

---

## Ride sections feature

> *"Log the sections of a line I've ridden."* Independent from eki stamps.

### Behaviour

- **All lines are discreet by default** — a faint tint of their own colour
  (`LINE_BASE`). The stretch you rode is drawn over them at full colour
  (`RIDE_OVERLAY`).
- **Tap a line → popup → "Add a ride"** puts the map into **ride edit mode** for
  that line (section 7c). Selection happens *on the map* — the right model for
  branched/looping lines, which a single list can't represent. Each inter-station
  segment is drawn individually with a node at each station (collected stamps are
  gold). A floating toolbar shows the line name + Save / Cancel.
- **Tap a segment** to toggle it; **drag along the line** to paint a stretch (the
  first segment touched decides add-vs-remove). A drag that starts *on* the line
  paints and locks map-panning for that gesture; a drag that starts *off* the line
  still pans. The map auto-fits the line on entry.
- **Save** writes the selection and paints the ridden stretches onto the map,
  following the real track geometry. Branches and multiple separate stretches are
  supported because each segment is independent.
- **Focus:** while editing, every other line is faded right down, other lines'
  ride overlays are faded, and hover-highlight is suppressed, so only the line
  being edited stands out.

Rides are stored as **segment keys** `"codeA|codeB"` (the two stations of a ridden
inter-station segment). `renderRideOverlays` also still understands the older
station-code arrays, so previously-saved rides keep rendering.

### How a clicked line maps to its stations (the important bit)

Two different sources are combined, each used for what it's actually good at:

- **Geometry** (`railroad-section.geojson`) → *which existing segments to colour.*
- **Ordered station groups** (`stations.json`, ekidata) → *which stations, in what
  order.* (Matching the two by **name** is unreliable, so we don't — see the
  handover doc.)

`buildLineGeometry(name, seed)` (lazy, cached in `lineGeomCache`) does:

1. **Stitch** (`stitchChains`) the clicked line's GeoJSON segments into ordered
   chains by matching coincident endpoints.
2. **Keep only the clicked corridor.** A bare `路線名` can be reused in different
   regions (the Tokyo *and* Osaka 山手線 share the name, 420 km apart). Starting
   from the chain nearest the click `seed`, we transitively keep chains within
   `RIDE_BRIDGE_M` (6 km) and **drop far same-name regions**.
3. **Build the station list from ekidata's ordered groups, not from proximity** —
   and **merge the corridor's lines**. One geojson line is usually served by
   several ekidata lines (rapid + local + through); any single group skips the
   others' stops (e.g. `中央本線` jumps Shinjuku→Kichijoji, skipping Nakano/Kōenji).
   So we take the richest on-corridor group as a **backbone** (its stations in
   ekidata order, `RIDE_INCLUDE_M` tolerance), then **insert every other corridor
   line's extra stops** (tight `RIDE_SNAP_M` snap, ≥3 hits so perpendicular
   crossings are ignored) into the backbone edge each best fits (least detour).
   The result is the *complete* line, correctly ordered, with **no foreign/parallel
   stations and no duplicates** — which blind proximity can't do in dense areas.
   (Falls back to plain proximity only for lines absent from ekidata.)
4. **Join the line's own fragmented chains** (`bridgeChains`, ≤ `RIDE_STITCH_M`):
   the source data often splits one continuous line into pieces (central-Tokyo
   track is frequently labelled under a different line name, leaving ~500 m holes).
   We connect a chain's ends across these small gaps so the line is continuous.
5. **Colour only existing geometry** (`renderRideOverlays` → `trackBetween`):
   between two adjacent ridden stations, slice the **exact existing track
   vertices** between their snapped positions. If the two still land on different
   chains (a *large* gap), the pair is **skipped — never bridged with an invented
   line across the map**.

The overlay is therefore always a slice of the already-drawn geometry (plus the
sub-`RIDE_STITCH_M` joins that close holes in one continuous line); nothing is
synthesized across real distances.

**Shinkansen are a curated exception.** `stations.json` has no Shinkansen lines
at all, so we can't derive their stops the normal way. Instead
`data/shinkansen.json` (built by `scripts/build_shinkansen.py`) lists each
Shinkansen's ordered stops with coordinates resolved from the station data. The
app doesn't draw the raw geojson Shinkansen fragments directly (they're
disjoint and unordered), but it **does follow them**: `shinkansenPath` stitches
each line's bundled track fragments into ordered chain(s) (`SHK_BRIDGE_M` joins
pieces split by tunnels), snaps every curated stop onto that real track
(`SHK_SNAP_M`), and builds the drawn path by **slicing the real track vertices
between consecutive on-track stops** — so the line follows the actual curvature.
Where a line has no own track for a span, it **borrows the physically-shared
track from the pooled Shinkansen geometry** (`buildShinkansenPool` /
`borrowSlice`): shared corridors like Tokyo–Takasaki are stored under whichever
Shinkansen the geojson labelled them, so e.g. 北陸's Omiya→Takasaki follows the
real shared viaduct rather than a straight hop. A length-ratio guard (0.7–1.7×
the straight chord) stops a stitched branch from ever introducing a detour. Only
spans no Shinkansen covers at all (the newer Kanazawa–Tsuruga extension, a couple
of mid-line data gaps, the Seikan tunnel) stay as a straight connector, and a
line with no usable geometry falls back to a centripetal Catmull-Rom smooth
(`shinkansenSmooth`). The same path drives both the drawn line and the ride
overlays (stops are anchor vertices in it). Shinkansen fade exactly like every
other line when not ridden (`SHINKANSEN_BASE` mirrors `LINE_BASE`). The ride
logic uses the stops directly (no corridor/merge). Stops that share a
conventional station use that station's record, so collected-stamp badges
light up there; the ~18 Shinkansen-only stations (新富士, 岐阜羽島, …) use
synthetic `shk_*` codes and have no stamp linkage. The 西九州新幹線 has no
track in the bundled geojson at all, so it draws as the smoothed curve until
the upstream geometry is refreshed.

**Known limitations (acceptable for now):**
- Where a `路線名` has parallel rapid/local alignments, the best-fit group is one
  of them; a few stops on the other alignment may not snap (e.g. the central
  Tōkyō Chūō stations Tokyo/Kanda/Ochanomizu sit on relabelled track and don't
  appear). The handover documents this as a genuinely hard case.
- A national track-accurate version (`data/rail-graph.json` + Dijkstra) is
  documented in `docs/HANDOVER-line-highlight.md` as a future option.

#### Ride gaps (chain holes) and the audit

The base map draws *every* geojson segment of a line, so the ride overlay must
follow exactly that — **one source for both**. `trackBetween` routes the shortest
path along a graph of **all** the line's track vertices (`buildLineGraph` over
`geom.allChains` — every stitched chain, *before* the corridor filter drops far
same-name regions — keyed by rounded coordinate so junction/T-join points
reconnect). So a ride segment between two ekidata-adjacent stations follows the
real drawn line across chain boundaries. `buildRideSegments` builds one segment
per consecutive pair this way and **never invents a straight connector**: if the
graph can't link two stations, the geojson has no track there (the base line is
gapped too), so the ride shows the same gap. A route over `RIDE_ROUTE_MAX_M` is a
data anomaly and is dropped. The corridor filter still limits which *stations* a
ride lists (so the Ōsaka 山手 stops don't appear in a Tōkyō ride), but never which
track it can follow. `renderRideOverlays` renders through the same segments.

> Why no straight bridges? An earlier version filled gaps with short straight
> connectors, but that drew bogus lines across bare-name corridors like `本線`
> (which merges 京成 / 相鉄 / 京急 main lines). Routing on the real graph instead
> means unrelated railways stay disconnected (a gap, not a diagonal), and genuinely
> connected track is always followed — edit mode and view mode look identical.

Don't chase gaps one screenshot at a time — run the audit, which drives the real
app (exact same geometry code) and lists every line's remaining gaps, classified
`HOLE` (no track there — the base line is gapped too) or `SPLIT-TRACK` (track
nearby but the route was absent/over `RIDE_ROUTE_MAX_M`):

```sh
python3 -m http.server 8097 &                 # serve the repo
BASE_URL=http://127.0.0.1:8097 node scripts/audit-ride-gaps.mjs   # exits 1 if gaps exceed MAX_GAPS (default 0)
```

CI runs this on every PR touching `data/`, `index.html`, or `scripts/`
(`.github/workflows/data-audit.yml`) with `MAX_GAPS` set to the accepted
baseline of known-genuine data holes, so only regressions fail the build.

(The audit waits for all line features to finish rendering first — building
geometry mid-render caches an incomplete graph and reports false gaps; the app
itself guards the same way via `linesReady`.) The 15 residual gaps (the CI
baseline) are all genuine: remote rural stretches the geojson lacks (予讃線
Shimonada, 上越線 Gala-Yuzawa, 筑肥線 Yamamoto branch), the 成田線 Abiko branch
station-order anomaly, and a few small seams where the homonym split exposed
that a corridor's central span is labelled under a different name (京急本線 at
Yokohama, 富山地鉄本線, おおさか東線…). Those need a station-list/corridor or
relabelling fix, not a faked line.

### Persistence shape

Rides are stored on `state.rides` and saved in the same Gist as stamps:

```jsonc
{
  "stamps": ["eki_1130223", ...],
  "rides":  { "いすみ線": ["eki_xxx|eki_yyy", ...], ... }  // ridden inter-station segment keys
}
```

---

## Sync / accounts

There is no server. Progress is **local-first**: every change is mirrored to
`localStorage` immediately, so the app works fully offline / anonymously.

For cross-device sync, the user pastes their **own** GitHub token (create one
with **only the `gist` scope**) into the Session panel. It is stored in
`localStorage` on that device only. With a token set, the app finds (or
creates) a private Gist **on the user's own account** whose description is
`GIST_PREFIX + name` and reads/writes `stamps.json` in it, on a short debounce
after any change (`scheduleSave`).

> **Never embed a shared token in this file.** An earlier version shipped an
> obfuscated account token; anyone could decode it and read/overwrite every
> user's data through it, and all users shared one API rate limit. That token
> must be treated as compromised and revoked. Users of the old version need to
> **Export JSON** from a device that still has their data and re-import it.

---

## Regenerating data

The full pipeline, in dependency order (all scripts are repo-root anchored and
can be run from anywhere):

```bash
python3 scripts/scrape_funakiya.py           # stage 1: line pages -> data/funakiya-raw.json
python3 scripts/scrape_funakiya_jp.py        # stage 2: per-station kanji/coords -> data/funakiya-stations.json
python3 scripts/scrape_funakiya_lines.py     # stage 3: line-name registry -> data/funakiya-lines.json
python3 scripts/build_stamp_stations.py      # -> data/stamp-stations.json
python3 scripts/build_rail_graph.py          # -> data/rail-graph.json
python3 scripts/build_shinkansen.py          # -> data/shinkansen.json
```

Notes:
- The scrapers cache pages in `/tmp/funacache` with **no TTL** — delete that
  directory to force a fresh scrape.
- `build_stamp_stations.py` uses `pykakasi` (optional) for romanised fallback
  names; without it installed, fallback romanisation silently degrades, so
  install it before regenerating for real (`pip install pykakasi`).
- After refreshing `railroad-section.geojson` from upstream, run
  `python3 scripts/disambiguate_geojson_lines.py` to re-split the homonymous
  bare line names (idempotent, in place).

Bump `APP_VERSION` in `js/config.js` when shipping new data — it is part of
**both** IndexedDB cache keys (stations *and* line geometry), so bumping it
forces every client to pick up fresh data. Stale versions' caches are pruned
automatically at startup.

---

## Conventions

- **No build step.** The app is plain static files + native ES modules — no
  npm, no bundler, no toolchain. Keep it that way: new code goes in a `js/`
  module (match the existing header/comment style), styles in `css/app.css`.
- **One module ≈ one concern.** Shared layer collections and cross-module
  runtime scalars live in `js/registry.js` (`ui.*`); user progress lives on
  `state`. `js/geometry.js` must stay pure (no DOM/Leaflet/app state) so its
  unit tests keep running under plain `node --test tests/*.test.mjs`.
- **Tooling contract.** Anything CI/scripts need from inside the app is
  exposed on `window.__eki` (set in `js/main.js`) — extend it, don't reshape
  it.
- **Touch-first.** Everything must work without a mouse (no hover-only actions).
  The canvas map itself is pointer/touch-driven (markers aren't keyboard
  focusable); panels, search, and modals must stay keyboard-accessible.
- **Never embed credentials** — see "Sync / accounts".
- **Language-aware.** Any user-facing name should respect `state.lang` and rebuild
  on toggle.
- **Always use the curated names, never ekidata's raw romaji.** Funakiya's curated
  English station names and the curated line names (`stamp-stations.json`,
  `funakiya-lines.json`, surfaced via `lineEnMap` and the curated-by-kanji lookup)
  are the source of truth for display. ekidata's auto-romaji is frequently wrong
  (e.g. 米原 → "Yonehara", 四ツ谷 → "Shitsutani", 新高円寺 → "Niitakaentera"). The
  ride picker resolves names in this order: (1) curated name, with the network
  qualifier stripped (中野坂上 "Toei Subway Nakano-sakaue" → "Nakano-sakaue"); (2)
  for an un-curated compound, a directional prefix + curated base (新中野 →
  Shin-Nakano); (3) ekidata romaji only as a last resort. Any new name-showing UI
  must follow the same precedence.
