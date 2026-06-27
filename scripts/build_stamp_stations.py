#!/usr/bin/env python3
"""Build data/stamp-stations.json — the authoritative list of stations that
have a physical eki stamp, scraped from Funakiya's Travel Stamp Book.

Inputs
  data/funakiya-raw.json       stage 1: line pages -> {slug,name_full,status}
  data/funakiya-stations.json  stage 2: slug -> {kanji,yomi,lat,lon}
  data/stations.json           ekidata (for linking code/line + dedup)

Only "Found" entries (a real stamp physically at the station) are kept.
Each station is matched to ekidata by COORDINATES (romaji-independent, since
ekidata's English romanisation is unreliable), falling back to kanji. The
display English name comes from Funakiya (properly spaced, operator stripped).
Stations Funakiya knows but ekidata doesn't (minor private lines) are still
included using Funakiya's own kanji/coords.
"""
import json, re, math
from collections import defaultdict

OP_PREFIX = {"JR","JNR","TX","IR","IGR","KTR","SR","ST","TKK","WKT","Watetsu"}
MACRON = {"ā":"a","ī":"i","ū":"u","ē":"e","ō":"o","Ā":"A","Ī":"I","Ū":"U","Ē":"E","Ō":"O",
          "â":"a","î":"i","û":"u","ê":"e","ô":"o","’":"'"}

def demacron(s):
    return "".join(MACRON.get(c, c) for c in s)

def clean_en(name_full):
    name = name_full.replace(" Station", "").strip()
    toks = name.split()
    if toks and (toks[0] in OP_PREFIX or re.fullmatch(r"[A-Z]{2,4}", toks[0])):
        toks = toks[1:]
    return demacron(" ".join(toks)).strip()

def clean_kanji(kanji):
    if not kanji: return None
    k = re.sub(r"^[A-Za-z0-9 ]+", "", kanji)          # strip leading 'JR' etc.
    k = re.sub(r"駅$", "", k)
    return k.strip()

def normk(k):
    return re.sub(r"[ 　・]", "", k) if k else k

raw = json.load(open("data/funakiya-raw.json", encoding="utf-8"))
jp  = json.load(open("data/funakiya-stations.json", encoding="utf-8"))
eki = json.load(open("data/stations.json", encoding="utf-8"))

# ekidata spatial grid (0.01deg ~1.1km cells) + kanji index
grid = defaultdict(list)
eki_by_kanji = defaultdict(list)
for g in eki:
    for s in g["stations"]:
        rec = {"code":s["code"],"name_kanji":s["name_kanji"],"lat":s["lat"],
               "lon":s["lon"],"line_code":g["line_name"],
               "line_en":(g.get("line_name_en") or "").lower()}
        grid[(round(s["lat"]/0.01), round(s["lon"]/0.01))].append(rec)
        eki_by_kanji[normk(s["name_kanji"])].append(rec)

def pick_by_line(cands, line_en):
    """Disambiguate same-kanji candidates by line-name token overlap."""
    if len(cands) == 1:
        return cands[0]
    toks = set(re.findall(r"[a-z]+", (line_en or "").lower())) - \
           {"jr","line","main","railway","電鉄","express"}
    best, bestscore = cands[0], -1
    for c in cands:
        score = len(toks & set(re.findall(r"[a-z]+", c["line_en"])))
        if score > bestscore:
            best, bestscore = c, score
    return best

def haversine(a, b, c, d):
    R=6371000; p=math.pi/180
    x=(math.sin((c-a)*p/2)**2 + math.cos(a*p)*math.cos(c*p)*math.sin((d-b)*p/2)**2)
    return 2*R*math.asin(math.sqrt(x))

def coord_match(lat, lon, kcore):
    if lat is None or lon is None: return None
    gi, gj = round(lat/0.01), round(lon/0.01)
    best=None; bestd=1e9
    for di in (-1,0,1):
        for dj in (-1,0,1):
            for r in grid.get((gi+di,gj+dj), []):
                d=haversine(lat,lon,r["lat"],r["lon"])
                kmatch = kcore and normk(kcore)==normk(r["name_kanji"])
                # prefer kanji-confirmed within 1.5km, else nearest within 500m
                score = d - (2000 if kmatch else 0)
                if score<bestd and (d<1500 if kmatch else d<500):
                    bestd=score; best=r
    return best

# aggregate per unique Found slug
agg = {}
for line in raw["lines"]:
    for st in line["stations"]:
        if st["status"] != "Found": continue
        slug = st["jp_slug"]
        a = agg.setdefault(slug, {"name_full":st["name_full"],
                                   "lines_en":set(), "is_jnr":False})
        a["lines_en"].add(line["line_name_en"])
        if st["name_full"].startswith("JNR") or line["line_slug"].startswith("jnr-"):
            a["is_jnr"]=True

stations=[]; by_code={}; n_eki=0; n_only=0; n_nodata=0
for slug, a in sorted(agg.items()):
    meta = jp.get(slug) or {}
    kcore = clean_kanji(meta.get("kanji"))
    lat, lon = meta.get("lat"), meta.get("lon")
    line_en = sorted(a["lines_en"])[0] if a["lines_en"] else ""
    if lat is not None and lon is not None:
        # Has coordinates: trust location only. No nearby ekidata station means
        # it's genuinely absent from ekidata (keep as funakiya-only at its own
        # coords) — never kanji-fallback to a same-name station elsewhere.
        m = coord_match(lat, lon, kcore)
    elif kcore:
        # Coordless (simple-template, minor/private rail): match by kanji,
        # stripping the operator prefix via longest trailing substring
        # (阿武隈急行保原 -> 保原); disambiguate collisions by line.
        nk = normk(kcore)
        m = None
        for L in range(len(nk)-1):
            c = eki_by_kanji.get(nk[L:])
            if c:
                m = pick_by_line(c, line_en); break
    else:
        m = None
    rec = {
        "slug": slug,
        "name_kanji": (m["name_kanji"] if m else kcore),
        "name_en": clean_en(a["name_full"]),
        "yomi": meta.get("yomi"),
        "lat": (m["lat"] if m else lat),
        "lon": (m["lon"] if m else lon),
        "lines": sorted(a["lines_en"]),
        "eki_code": (m["code"] if m else None),
        "eki_line": (m["line_code"] if m else None),
    }
    if rec["lat"] is None or rec["name_kanji"] is None:
        n_nodata+=1; continue               # cannot place on map
    rec["code"] = m["code"] if m else f"fk_{slug}"
    if m: n_eki+=1
    else: n_only+=1
    # merge interchange stations that resolve to the same ekidata code
    prev = by_code.get(rec["code"])
    if prev:
        prev["lines"] = sorted(set(prev["lines"]) | set(rec["lines"]))
        prev["slug"] = prev["slug"] + "," + slug
    else:
        by_code[rec["code"]] = rec
        stations.append(rec)

out={"source":"stamp.funakiya.com","count":len(stations),"stations":stations}
json.dump(out, open("data/stamp-stations.json","w",encoding="utf-8"),
          ensure_ascii=False, indent=1)
matched = sum(1 for s in stations if s["eki_code"])
print(f"total stamp stations (deduped): {len(stations)}")
print(f"  matched to ekidata : {matched}")
print(f"  funakiya-only      : {len(stations)-matched}")
print(f"  dropped (no coords/kanji): {n_nodata}")
