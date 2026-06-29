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
  shinkansen.json               curated Shinkansen lines (ordered stops + coords)
scripts/
  scrape_funakiya*.py           scrapers for the Funakiya stamp catalogue
  build_stamp_stations.py       builds data/stamp-stations.json
  build_rail_graph.py           builds data/rail-graph.json from the GeoJSON
  build_shinkansen.py           builds data/shinkansen.json (curated Shinkansen stops)
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
| 7c. Ride edit mode | select ridden stretches **on the map** (handles branches) |
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
logic uses the stops directly (no corridor/merge). Stop coordinates match the
conventional-station records, so collected-stamp badges still light up.

**Known limitations (acceptable for now):**
- Where a `路線名` has parallel rapid/local alignments, the best-fit group is one
  of them; a few stops on the other alignment may not snap (e.g. the central
  Tōkyō Chūō stations Tokyo/Kanda/Ochanomizu sit on relabelled track and don't
  appear). The handover documents this as a genuinely hard case.
- At *large* chain gaps within a corridor, the stretch isn't coloured (we won't
  draw a synthetic connector — only sub-`RIDE_STITCH_M` holes are joined).
- A national track-accurate version (`data/rail-graph.json` + Dijkstra) is
  documented in `docs/HANDOVER-line-highlight.md` as a future option.

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
