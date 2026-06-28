# Handover: "highlight the stretch of line ridden between stations"

Goal of the next session: let a user mark stations they rode and highlight the
**part of the line between them** on the map.

This doc captures what was investigated so you don't repeat it, the recommended
approach, the data already precomputed for you, and the parts that are still
genuinely hard.

---

## TL;DR

1. **Do NOT match station line-names to the track geometry names.** It can't reach
   100% and it's the wrong tool. (Evidence below.)
2. **The perfect station↔line association already exists in `data/stations.json`**
   (ekidata), which the app already loads. Each line is a list of its stations
   **in geographic order**, keyed by code. Within a line a station is uniquely
   identified by its **kanji name** (canonical — no romaji ambiguity).
3. Build the feature in two tiers:
   - **v1 (easy, robust, recommended first):** highlight = the slice of a line's
     ordered station list between the two chosen stations, drawn as a polyline
     through those stations' coordinates. No GIS, always correct topologically.
   - **v2 (track-accurate curves):** snap that station sub-sequence onto the real
     rail geometry. Raw material is precomputed in `data/rail-graph.json`. This is
     a real GIS task — see "Open problems".

---

## Why name matching is a dead end (measured)

Matching the station's line (ekidata kanji `line_name`) to the track geometry's
`路線名` in `railroad-section.geojson`:

| Method | Match rate |
|---|---|
| exact string | 57 / 390 lines |
| normalized (strip operator prefix + spaces) | 149 / 390 lines |

The geometry has **no codes** — only a bare `路線名`, operator, and raw
`LineString`. ekidata names carry operator prefixes (`東急`,`近鉄`,`JR`), service
qualifiers (`(快速)`), and range suffixes (`(苫小牧～岩見沢)`). And some names
collide across regions (`中央線` = JR Chūō **and** Osaka Metro Chūō).

## Why a single national graph + nearest-snap is also wrong

`data/rail-graph.json` (below) is a correct national routing graph, but routing
between two stations with **nearest-endpoint snapping** detours at interchanges:

- Kanda→Tokyo (1.2 km apart) routed **7.4 km**, because Tokyo's *nearest* track
  endpoint is a 総武線/東海道線 platform 117 m away, on different tracks than
  Kanda's 中央線 node. The graph is fine; blind snapping picks the wrong line.

The fix is to **constrain to the ridden line** — which you know, because the
feature input is a line. That's the v2 approach, and why each graph edge now
carries its `路線名`.

---

## Recommended approach

### v1 — station-sequence polyline (do this first)

```
group data/stations.json by line_name            # already ordered
pick the line group L the user rode
find the two endpoint stations in L.stations by KANJI name (exact, unique in L)
slice L.stations between those two indices (inclusive)
draw an L.polyline through the sliced stations' [lat,lon]
```

This is ~30 lines, never wrong about *which* stations are included, and needs no
geometry file. It draws straight hops between consecutive stations (no track
curve) — acceptable for v1 and often barely noticeable at city zoom.

Linking a **stamp** station (`data/stamp-stations.json`) to its slot in a line:
match by `name_kanji` within the line group (or by coordinates). Note the
`eki_code` in stamp-stations is NOT the same per-line code ekidata uses inside
each line group, so don't join on it directly.

### v2 — track-accurate curve (optional polish)

Use `data/rail-graph.json`. Algorithm:

```
resolve the ridden line -> its 路線名(s)         # see "line resolution" below
subgraph = edges whose line_idx is in that set
snap each chosen station to the nearest node IN the subgraph (not globally)
shortest-path (Dijkstra) between consecutive stations within the subgraph
concatenate the edges; draw each edge's geometry from the geojson feature
  (edge[3] = feature index; reverse coords if the edge is traversed v->u)
```

---

## Precomputed artifact: `data/rail-graph.json`  (~1.0 MB)

Built by `scripts/build_rail_graph.py` from `railroad-section.geojson`.
Topology is clean: 22,016 single-LineString segments whose endpoints coincide to
sub-metre precision, giving **20,718 nodes / 22,015 edges**. Interior shape
points are not nodes — pull them from the geojson feature for drawing.

```jsonc
{
  "lines":   ["沖縄都市モノレール線", ...],        // line_idx -> 路線名
  "nodes":   [[lat, lon], ...],                    // 5dp; node index = array index
  "edges":   [[u, v, len_m, feat, line_idx], ...], // u,v node idx; feat = geojson feature index
  "stations":{ "eki_1130223": [node, snap_m], ...},// stamp-station code -> nearest endpoint + metres
  "far":     [["fk_xxx", null], ["eki_y", 1749], ...] // see below
}
```

Station snap quality (to nearest endpoint): **median 63 m, p90 124 m, max 1749 m**.
- `stations` covers 2,338 stamp stations.
- `far` lists the ones to handle specially: **70 stations have no nearby track**
  (defunct/funakiya-only lines such as the JNR Haboro line — there is literally
  no modern geometry to highlight), and **14 are >200 m** from an endpoint.

> The `stations` snap here is the *global* nearest endpoint and is therefore
> line-blind — fine for "where is this station roughly on the network", but for
> the actual highlight you should re-snap within the ridden line's subgraph (v2)
> or use the station-sequence approach (v1).

To regenerate: `python3 scripts/build_rail_graph.py`

---

## Line resolution (ekidata line -> 路線名), for v2

There is no code bridge, so map by **spatial voting**: for an ekidata line, snap
each of its stations to nearby geojson features and take the majority `路線名`.
Validated examples (vote winners):

| ekidata line | wins 路線名 | notes |
|---|---|---|
| 都営大江戸線 | 12号線大江戸線 (28/38) | clean |
| JR中央線(快速) | 中央線 (16/24) | clean-ish |
| 東急田園都市線 | 田園都市線 (23/27) | clean |
| JR山手線 | 山手線 8 / 東北線 6 / 東北新幹線 4 | **ambiguous** |

The Yamanote ambiguity is real, not a bug: the east side of the loop runs on
官 Tōhoku/Tōkaidō track and is labelled as such. The product owner already chose
to keep track geometry and accept this.

---

## Open problems for v2 (track-accurate) — read before committing to it

These are why v2 is a project, not an afternoon:

1. **Central-Tokyo relabelling.** The Kanda–Tokyo Chūō viaduct is not labelled
   `中央線` in the geometry, so a pure `中央線` subgraph has no path to Tokyo
   (Tokyo snaps ~1.1 km away). Line resolution must allow a small set of
   `路線名` per line, or fall back to nearest-track across labels near termini.
2. **Parallel rapid/local tracks.** Chūō (and many JR lines) have separate rapid
   and local alignments, both plausibly the "same" line; pick one deterministically
   or you get +1–2 km errors (Yotsuya→Ochanomizu measured 3.9 km vs ~2.1 km real).
3. **Branches and loops** (Ōfunato, Yamanote ring, freight spurs) break naive
   "longest chain" assembly — assemble per consecutive-station-pair instead.
4. **Duplicate `路線名` across regions** — always constrain to the corridor of the
   line's own stations before chaining/voting.
5. **70 stations have no geometry at all** (defunct lines) — v2 must degrade to v1
   (straight hop) for these.

Given 1–4, a robust v2 likely routes **per consecutive station pair** on the
line-subgraph with line-aware snapping, rather than pre-assembling whole lines.

---

## Files

| File | Role |
|---|---|
| `data/rail-graph.json` | precomputed routing graph (v2 raw material) |
| `scripts/build_rail_graph.py` | regenerates the graph |
| `data/stations.json` | ekidata; ordered per-line station groups (v1 basis) — already loaded by the app |
| `data/stamp-stations.json` | the app's stamp stations (`code`, `name_kanji`, `lat/lon`, `lines`) |
| `data/railroad-section.geojson` | track geometry; edge `feat` indexes into `.features` |
