# Eki Stamp Tracker

An interactive map of Japan for tracking **eki stamps** (駅スタンプ — the rubber
stamps collected at railway stations) and **logging the sections of train lines
you've ridden**.

The whole app is a single, dependency-light `index.html`. Open it in a browser
(or serve the folder) and it works — no build step.

---

## Quick start

```bash
# Any static file server works; the app fetches the JSON/GeoJSON in data/ over HTTP.
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Opening `index.html` directly via `file://` mostly works but some browsers block
`fetch()` of the local data files, so a static server is recommended.

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
4. **Sync.** Progress (stamps *and* rides) is saved to a private GitHub Gist keyed
   by a user-chosen "sync name", so it follows you across devices. Also
   importable/exportable as JSON.
5. **Bilingual.** Toggle EN / 日本語 for all station and line names.

---

## File layout

```
index.html                      The entire app (markup + CSS + JS in one file)
README.md                       This file
data/
  stations.json                 ekidata: every line with its stations IN ORDER (lat/lon)
  stamp-stations.json           the curated stamp stations (which markers to draw)
  funakiya-lines.json           curated EN/kanji names for lines
  funakiya-stations.json        curated station name data (Funakiya scrape)
  funakiya-raw.json             raw Funakiya scrape (source for the above)
  railroad-section.geojson      track geometry: one LineString per segment, keyed by 路線名
  rail-graph.json               precomputed national routing graph (for future track work)
scripts/
  scrape_funakiya*.py           scrapers for the Funakiya stamp catalogue
  build_stamp_stations.py       builds data/stamp-stations.json
  build_rail_graph.py           builds data/rail-graph.json from the GeoJSON
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
**many** segments sharing the same `路線名`.

> ⚠️ The line names in `railroad-section.geojson` (`路線名`) and in
> `stations.json` (`line_name`) **do not match** reliably (only ~35% exact /
> ~50% normalized). Do not join them by name — see
> `docs/HANDOVER-line-highlight.md`.

---

## Code map (`index.html`)

All logic is one inline `<script>`. It is organised into numbered sections:

| Section | What lives there |
|---|---|
| 2. Constants | tunables: cache TTL, marker sizing, **line prominence styles**, **ride snap distance** |
| 3. App state | `state` = `{ lang, user, gistId, stamps:Set, rides:{} }` |
| 4. Gist persistence | `loadFromGist`, `syncToGist` (persists stamps **and** rides), `findGistId` |
| 5. Notifications | toasts + sync-status indicator |
| 6. Map init | Leaflet map, canvas renderer, custom touch gestures |
| 7. Line rendering | draws GeoJSON lines (faint by default), hover/tap highlight, **line popup** |
| 7b. Ride sections | stitching, station snapping, **ridden-stretch overlays** (see below) |
| 7c. Ride modal | the vertical **swipe-to-pick** station selector |
| 8. Marker management | builds/merges station markers, collect toggle |
| 9. Popup | station popup HTML (collect button) |
| 10–15 | search, language toggle, stats, session panel, welcome modal, **init** |

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
- **Tap a line → popup → "Add a ride".** Opens the *ride picker*: a vertical
  diagram of every station on that line.
- **Swipe** (click-drag) along the stations to select the stretch you rode, like
  selecting multiple photos on iOS. The first station you touch decides the mode:
  starting on an un-selected station **adds**; starting on a selected one
  **removes** (de-highlights). Edge auto-scroll handles long lines.
- **Save** paints the selected stretch onto the map, following the real track
  geometry. Multiple, non-contiguous sections per line are supported.

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
3. **Pick the station list from ekidata, not from proximity.** For each ekidata
   line group, take its stations that snap onto the corridor (within
   `RIDE_SNAP_M`, 60 m) **in ekidata order**, and choose the group with the best
   fit. This yields *this* line's real stations, correctly ordered, with **no
   parallel-line/interchange stations and no duplicates** — which blind proximity
   snapping cannot do in dense areas. (Falls back to proximity only for lines
   absent from ekidata.)
4. **Colour only existing geometry** (`renderRideOverlays` → `trackBetween`):
   between two adjacent ridden stations, slice the **exact existing track
   vertices** between their snapped positions. If the two land on different chains
   (a data gap), the pair is **skipped — never bridged with an invented line**.

The overlay is therefore always a slice of the already-drawn geometry; nothing is
synthesized.

**Known limitations (acceptable for now):**
- Where a `路線名` has parallel rapid/local alignments, the best-fit group is one
  of them; the other's stations may not all snap. The handover documents this as a
  genuinely hard case.
- At chain gaps within a corridor, the stretch across the gap isn't coloured
  (we won't draw a synthetic connector).
- Station English names here come straight from ekidata's auto-romaji, which is
  sometimes wrong (e.g. 四ツ谷 → "Shitsutani"); the kanji is always correct.
- A national track-accurate version (`data/rail-graph.json` + Dijkstra) is
  documented in `docs/HANDOVER-line-highlight.md` as a future option.

### Persistence shape

Rides are stored on `state.rides` and saved in the same Gist as stamps:

```jsonc
{
  "stamps": ["eki_1130223", ...],
  "rides":  { "いすみ線": ["eki_xxx", "eki_yyy", ...], ... }  // ridden station codes per line
}
```

---

## Sync / accounts

There is no server. "Accounts" are just a **sync name** the user types; the app
finds (or creates) a private Gist whose description is `GIST_PREFIX + name` and
reads/writes `stamps.json` in it. The Gist is updated on a short debounce after
any change (`scheduleSave`). A GitHub token is required for the Gist API; see how
`getToken()` is wired in `index.html`.

---

## Regenerating data

```bash
python3 scripts/scrape_funakiya.py        # scrape the stamp catalogue
python3 scripts/build_stamp_stations.py   # -> data/stamp-stations.json
python3 scripts/build_rail_graph.py       # -> data/rail-graph.json
```

Bump `APP_VERSION` in `index.html` when shipping new data — it is part of the
IndexedDB cache key, so bumping it forces every client to pick up fresh data.

---

## Conventions

- **Single file.** Keep markup, CSS, and JS in `index.html`; match the existing
  numbered-section structure and comment style.
- **Touch-first.** Everything must work without a mouse (no hover-only actions).
- **Language-aware.** Any user-facing name should respect `state.lang` and rebuild
  on toggle.
