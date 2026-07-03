#!/usr/bin/env python3
"""Build data/rail-graph.json — a routing graph of the national rail network,
for highlighting the stretch of track ridden between stations.

Why a graph (not a name match): stations and the track geometry share no code,
and matching by line name reaches only ~150/390 lines. Geometry is the reliable
key — every station has lat/lon, every track is a polyline. We therefore build a
graph straight from the geometry and snap stations onto it.

Topology: railroad-section.geojson has 22,016 single-LineString segments whose
endpoints coincide to sub-metre precision (so junctions are exact). The graph is
thus ~20.7k nodes (segment endpoints) and ~22k edges (the segments). Interior
shape points are NOT graph nodes; they live in the geojson and are reused for
drawing via each edge's feature index (the app already loads that file).

Stations snap to their nearest endpoint node. MLIT splits track at stations, so
77% of stations sit within 100 m of an endpoint and 96.6% within 200 m; the few
that are further (reported below) are flagged so the consumer can special-case
them or fall back to sub-segment projection.

Output: data/rail-graph.json
  { source, node_count, edge_count,
    lines:    [ "路線名", ... ],                  # line_idx -> track line name
    nodes:    [[lat,lon], ...],                   # 5dp, endpoint i
    edges:    [[u, v, len_m, feat, line_idx], ...]# node u->v, length (m), geojson feature index, line
    stations: { code: [node, snap_m], ...}        # station code -> nearest endpoint node + metres
    far:      [ [code, snap_m], ... ] }            # stations whose snap is > FAR_M (review these)
"""
import json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from collections import defaultdict

GEO   = os.path.join(ROOT, "data", "railroad-section.geojson")
STAMP = os.path.join(ROOT, "data", "stamp-stations.json")
OUT   = os.path.join(ROOT, "data", "rail-graph.json")
NDP   = 5          # node coordinate precision (~1.1 m): endpoints already coincide this tightly
FAR_M = 200        # flag stations whose nearest endpoint is further than this

def hav(a, b, c, d):
    R = 6371000.0; p = math.pi / 180
    x = math.sin((c-a)*p/2)**2 + math.cos(a*p)*math.cos(c*p)*math.sin((d-b)*p/2)**2
    return 2 * R * math.asin(math.sqrt(x))

def main():
    geo = json.load(open(GEO, encoding="utf-8"))
    ss  = json.load(open(STAMP, encoding="utf-8"))

    nodes = []                       # idx -> [lat, lon]
    node_id = {}                     # quantised (lat,lon) -> idx
    def node_of(lat, lon):
        k = (round(lat, NDP), round(lon, NDP))
        i = node_id.get(k)
        if i is None:
            i = len(nodes); node_id[k] = i; nodes.append([k[0], k[1]])
        return i

    edges = []                       # [u, v, len_m, feat, line_idx]
    lines = []; line_id = {}         # distinct 路線名 table (for line-aware subgraph routing)
    def line_of(name):
        i = line_id.get(name)
        if i is None:
            i = len(lines); line_id[name] = i; lines.append(name)
        return i
    for fi, f in enumerate(geo["features"]):
        c = f["geometry"]["coordinates"]
        if len(c) < 2:
            continue
        u = node_of(c[0][1],  c[0][0])
        v = node_of(c[-1][1], c[-1][0])
        if u == v:
            continue                 # degenerate loop segment
        length = sum(hav(c[k][1], c[k][0], c[k+1][1], c[k+1][0]) for k in range(len(c)-1))
        edges.append([u, v, round(length), fi, line_of(f["properties"].get("路線名", ""))])

    # spatial grid of endpoint nodes for snapping
    grid = defaultdict(list)
    for i, (lat, lon) in enumerate(nodes):
        grid[(round(lat/0.01), round(lon/0.01))].append(i)

    stations = {}; far = []
    for s in ss["stations"]:
        la, lo = s["lat"], s["lon"]
        gi, gj = round(la/0.01), round(lo/0.01)
        best, bestd = None, 1e18
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for i in grid.get((gi+di, gj+dj), []):
                    d = hav(la, lo, nodes[i][0], nodes[i][1])
                    if d < bestd:
                        best, bestd = i, d
        if best is None:
            far.append([s["code"], None]); continue       # no track nearby (defunct line)
        stations[s["code"]] = [best, round(bestd)]
        if bestd > FAR_M:
            far.append([s["code"], round(bestd)])

    out = {"source": "railroad-section.geojson",
           "node_count": len(nodes), "edge_count": len(edges),
           "edge_format": "[u, v, len_m, geojson_feature_idx, line_idx]",
           "lines": lines,                        # line_idx -> 路線名 (track name)
           "nodes": nodes, "edges": edges, "stations": stations, "far": far}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    snaps = [v[1] for v in stations.values()]
    snaps.sort()
    print(f"wrote {OUT}: {len(nodes)} nodes, {len(edges)} edges, "
          f"{os.path.getsize(OUT)//1024} KB")
    print(f"stations snapped: {len(stations)}; with no nearby track: "
          f"{sum(1 for c,d in far if d is None)}")
    if snaps:
        print(f"snap distance  median={snaps[len(snaps)//2]}m  "
              f"p90={snaps[int(len(snaps)*0.9)]}m  max={snaps[-1]}m")
    print(f"stations beyond {FAR_M}m of an endpoint (review): "
          f"{sum(1 for c,d in far if d is not None)}")

if __name__ == "__main__":
    main()
