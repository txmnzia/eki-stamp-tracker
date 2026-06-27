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
               "lon":s["lon"],"line_code":g["line_name"]}
        grid[(round(s["lat"]/0.01), round(s["lon"]/0.01))].append(rec)
        eki_by_kanji[normk(s["name_kanji"])].append(rec)

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

stations=[]; n_eki=0; n_only=0; n_nodata=0
for slug, a in sorted(agg.items()):
    meta = jp.get(slug) or {}
    kcore = clean_kanji(meta.get("kanji"))
    lat, lon = meta.get("lat"), meta.get("lon")
    m = coord_match(lat, lon, kcore)
    if not m and kcore:                      # fallback: exact kanji match
        c = eki_by_kanji.get(normk(kcore))
        m = c[0] if len(c)==1 else None
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
    stations.append(rec)

out={"source":"stamp.funakiya.com","count":len(stations),"stations":stations}
json.dump(out, open("data/stamp-stations.json","w",encoding="utf-8"),
          ensure_ascii=False, indent=1)
print(f"total stamp stations: {len(stations)}")
print(f"  matched to ekidata : {n_eki}")
print(f"  funakiya-only      : {n_only}")
print(f"  dropped (no coords/kanji): {n_nodata}")
