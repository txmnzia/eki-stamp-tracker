#!/usr/bin/env python3
"""Structural sanity checks on the shipped data files (fast, no network).

Run in CI (.github/workflows/data-audit.yml) and before shipping regenerated
data. Exits non-zero on the first violated invariant. These are the invariants
the app actually relies on — see docs/AUDIT-2026-07.md ("verified clean").
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def load(p): return json.load(open(os.path.join(ROOT, 'data', p), encoding='utf-8'))

JP_BBOX = (24.0, 46.5, 122.0, 154.0)   # lat min/max, lon min/max
def in_jp(lat, lon):
    return JP_BBOX[0] <= lat <= JP_BBOX[1] and JP_BBOX[2] <= lon <= JP_BBOX[3]

fails = []
def check(cond, msg):
    if not cond:
        fails.append(msg)
        print(f"FAIL: {msg}", file=sys.stderr)

# ── stations.json ───────────────────────────────────────────────────────────
st = load('stations.json')
codes = [s['code'] for g in st for s in g['stations']]
check(len(codes) == len(set(codes)), 'stations.json: duplicate station codes')
bad = [s for g in st for s in g['stations'] if not (s['lat'] and s['lon'] and in_jp(s['lat'], s['lon']))]
check(not bad, f'stations.json: {len(bad)} stations with missing/out-of-Japan coords')
code_set = set(codes)

# ── stamp-stations.json ─────────────────────────────────────────────────────
ss = load('stamp-stations.json')
check(ss['count'] == len(ss['stations']), 'stamp-stations.json: count mismatch')
dangling = [s['slug'] for s in ss['stations'] if s.get('eki_code') and s['eki_code'] not in code_set]
check(not dangling, f'stamp-stations.json: {len(dangling)} eki_codes not in stations.json: {dangling[:5]}')
nocode = [s['slug'] for s in ss['stations'] if not s.get('code')]
check(not nocode, f'stamp-stations.json: {len(nocode)} entries without a code')
badpos = [s['slug'] for s in ss['stations'] if not (s['lat'] and s['lon'] and in_jp(s['lat'], s['lon']))]
check(not badpos, f'stamp-stations.json: {len(badpos)} entries with bad coords')
import re
ents = re.findall(r'&(?:#\d+|apos|amp|quot|lt|gt);',
                  open(os.path.join(ROOT, 'data', 'stamp-stations.json'), encoding='utf-8').read())
check(not ents, f'stamp-stations.json: {len(ents)} literal HTML entities (run html.unescape in the scrapers)')

# ── railroad-section.geojson ────────────────────────────────────────────────
geo = load('railroad-section.geojson')
feats = geo['features']
check(all(f['geometry']['type'] == 'LineString' for f in feats), 'geojson: non-LineString feature')
noname = sum(1 for f in feats if not f['properties'].get('路線名'))
check(noname == 0, f'geojson: {noname} features missing 路線名')
short = sum(1 for f in feats if len(f['geometry']['coordinates']) < 2)
check(short == 0, f'geojson: {short} degenerate (<2 vertex) features')

# ── rail-graph.json ─────────────────────────────────────────────────────────
rg = load('rail-graph.json')
check(rg['node_count'] == len(rg['nodes']) and rg['edge_count'] == len(rg['edges']),
      'rail-graph.json: declared counts mismatch')
nn, nf, nl = len(rg['nodes']), len(feats), len(rg['lines'])
bad_edges = [e for e in rg['edges'] if not (0 <= e[0] < nn and 0 <= e[1] < nn and 0 <= e[3] < nf and 0 <= e[4] < nl)]
check(not bad_edges, f'rail-graph.json: {len(bad_edges)} edges with out-of-range indices')
geo_names = {f['properties']['路線名'] for f in feats}
stale = [l for l in rg['lines'] if l not in geo_names]
check(not stale, f'rail-graph.json: {len(stale)} line names not in geojson (stale graph? re-run build_rail_graph.py): {stale[:5]}')

# ── shinkansen.json ─────────────────────────────────────────────────────────
shk = load('shinkansen.json')
for name, info in shk.items():
    check(len(info['stations']) >= 2, f'shinkansen.json: {name} has <2 stops')
    for s in info['stations']:
        check(in_jp(s['lat'], s['lon']), f"shinkansen.json: {name}/{s['name_kanji']} out of bbox")

if fails:
    print(f'\n{len(fails)} check(s) failed', file=sys.stderr)
    sys.exit(1)
print('all data checks passed:',
      f"{len(codes)} stations, {ss['count']} stamps, {len(feats)} track features, "
      f"{rg['node_count']} graph nodes, {len(shk)} shinkansen")
