#!/usr/bin/env python3
"""Split homonymous (bare-name) lines in railroad-section.geojson by operator.

Some geojson features use a BARE 路線名 (日光線, 本線, 京都線…) shared by several
railways, so the app merges unrelated lines. ekidata's stations.json is
operator-qualified (JR日光線, 東武日光線…); we use it as the authority. For each
allow-listed homonym, every feature is reassigned to the ekidata line whose
station sequence runs nearest it (with a spatial-fill pass for stragglers).
Only the 路線名 string is edited, in place, line by line — geometry and file
formatting are preserved, so the diff is just the renamed features and normal
lines can't regress. Idempotent: already-split names no longer match a bare key.

Workflow: refresh the raw geojson from upstream, then run this to re-disambiguate.
Run: python3 scripts/disambiguate_geojson_lines.py
"""
import json, math, os, re, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# In-place rewrite of the production geojson is the intended workflow now the
# disambiguation is accepted; pass an explicit path to work on a copy instead.
GEO = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'railroad-section.geojson')
st = json.load(open(os.path.join(ROOT, 'data', 'stations.json')))
lines = open(GEO, encoding='utf-8', newline='').read().split('\n')

def md(a, b):
    sx = 111320 * math.cos(math.radians((a[0]+b[0])/2)); sy = 110540
    return math.hypot((a[1]-b[1])*sx, (a[0]-b[0])*sy)

# Reviewed allow-list of genuine homonyms (two+ real railways share the bare name).
HOMONYMS = {'本線','日光線','京都線','奈良線','山田線','城北線','長野線','鉄道線','甘木線',
 '東西線','南北線','北陸線','山手線','関西空港線','内部線','田原本線','江ノ島線','東葉高速線',
 '国分寺線','高尾線','鹿島線'}

# parse each feature line once: (line_index, 路線名, [(lat,lon)...])
feats = []   # (li, name, verts)
for li, ln in enumerate(lines):
    s = ln.strip().rstrip(',')
    if not s.startswith('{') or '"路線名"' not in s: continue
    try: o = json.loads(s)
    except Exception: continue
    nm = o['properties'].get('路線名', '')
    vs = [(lat, lng) for lng, lat in o['geometry']['coordinates']]
    feats.append((li, nm, vs))

# candidate ekidata lines per homonym = lines whose stations sit on its features (<=150m)
CELL = 0.004
grid = defaultdict(list)
for li, nm, vs in feats:
    for lat, lng in vs:
        grid[(round(lat/CELL), round(lng/CELL))].append((nm, (lat, lng)))
def snap_name(lat, lon, maxm=150):
    best, bd = None, maxm
    for di in (-1,0,1):
        for dj in (-1,0,1):
            for nm, c in grid.get((round(lat/CELL)+di, round(lon/CELL)+dj), []):
                d = md((lat, lon), c)
                if d < bd: bd = d; best = nm
    return best
cand = defaultdict(lambda: defaultdict(list))
for g in st:
    for s in g['stations']:
        nm = snap_name(s['lat'], s['lon'])
        if nm in HOMONYMS: cand[nm][g['line_name']].append((s['lat'], s['lon']))
cand = {nm: {ln: pts for ln, pts in d.items() if len(pts) >= 2} for nm, d in cand.items()}

# assign each homonym feature to the nearest candidate line; spatial-fill stragglers
assign = {}                      # li -> new name
done = []                        # (centroid, orig name, new name)
left = []
for li, nm, vs in feats:
    if nm not in cand or not cand[nm]: continue
    samp = vs[::max(1, len(vs)//8)] or vs
    best, bd = None, 1e18
    for ln, pts in cand[nm].items():
        d = sum(min(md(v, p) for p in pts) for v in samp) / len(samp)
        if d < bd: bd = d; best = ln
    c = (sum(v[0] for v in vs)/len(vs), sum(v[1] for v in vs)/len(vs))
    if best and bd < 3000: assign[li] = best; done.append((c, nm, best))
    else: left.append((li, nm, c))
for li, nm, c in left:
    best, bd = None, 1e18
    for ac, anm, aname in done:
        if anm == nm and md(c, ac) < bd: bd = md(c, ac); best = aname
    if best: assign[li] = best

# rewrite ONLY the 路線名 value on the affected lines (format preserved)
report = defaultdict(lambda: defaultdict(int))
for li, new in assign.items():
    old_line = lines[li]
    m = re.search(r'"路線名":\s*"([^"]*)"', old_line)
    old = m.group(1)
    if old == new: continue
    lines[li] = old_line[:m.start(1)] + new + old_line[m.end(1):]
    report[old][new] += 1

open(GEO, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
print('=== splits ===')
for nm in sorted(report):
    print(f'  {nm}  ->  ' + ', '.join(f'{ln}:{c}' for ln, c in sorted(report[nm].items(), key=lambda x:-x[1])))
print('\ntotal features renamed:', sum(sum(d.values()) for d in report.values()))
