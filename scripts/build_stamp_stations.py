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
from collections import defaultdict, Counter

# Operator names that appear as a leading word on Funakiya's English labels and
# are not part of the station name itself (station names with the operator baked
# in use a hyphen, e.g. "Seibu-Shinjuku", so they are one token and unaffected).
OP_PREFIX = {"JR","JNR","TX","IR","IGR","KTR","SR","ST","TKK","WKT","Watetsu",
             "Odakyu","Tobu","Keisei","Keikyu","Keio","Tokyu","Hankyu","Hanshin",
             "Kintetsu","Nankai","Meitetsu","Nishitetsu","Sotetsu","Nankai"}
MACRON = {"ā":"a","ī":"i","ū":"u","ē":"e","ō":"o","Ā":"A","Ī":"I","Ū":"U","Ē":"E","Ō":"O",
          "â":"a","î":"i","û":"u","ê":"e","ô":"o","’":"'"}

def demacron(s):
    return "".join(MACRON.get(c, c) for c in s)

def clean_en(name_full):
    name = demacron(name_full.replace(" Station", "").strip())
    toks = name.split()
    if toks and (toks[0] in OP_PREFIX or re.fullmatch(r"[A-Z]{2,4}", toks[0])):
        toks = toks[1:]
    return " ".join(toks).strip()

def clean_kanji(kanji):
    if not kanji: return None
    k = re.sub(r"^[A-Za-z0-9 ]+", "", kanji)          # strip leading 'JR' etc.
    k = re.sub(r"駅$", "", k)
    return k.strip()

def normk(k):
    return re.sub(r"[ 　・]", "", k) if k else k

try:
    import pykakasi
    _kks = pykakasi.kakasi()
except Exception:
    _kks = None

def _contract(s):
    return s.replace("ou", "o").replace("oo", "o").replace("uu", "u")

def romaji_kanji(kanji):
    """Spaced Hepburn romanisation of a kanji station name (JP-only lines)."""
    if not kanji or not _kks:
        return kanji or ""
    toks = [_contract(t["hepburn"]) for t in _kks.convert(kanji) if t["hepburn"].strip()]
    out = []
    for t in toks:
        if out and out[-1].lower() in ("o", "go"):   # merge honorific お/ご
            out[-1] = out[-1] + t
        else:
            out.append(t)
    return " ".join(w[:1].upper() + w[1:] for w in out).strip()

_LINE_SUFFIX = [("新幹線", " Shinkansen"), ("本線", " Main Line"),
                ("ライン", " Line"), ("線", " Line"), ("エクスプレス", " Express")]

# Curated English for irregular-reading or well-known track lines that romaji
# gets wrong (山手 reads "Yamanote", not "Yamate"; 丸ノ内 "Marunouchi", etc.).
CURATED_LINE = {
    "山手線": "Yamanote Line", "東北線": "Tohoku Line", "東北本線": "Tohoku Main Line",
    "東海道線": "Tokaido Line", "東海道本線": "Tokaido Main Line",
    "中央線": "Chuo Line", "中央本線": "Chuo Main Line",
    "総武線": "Sobu Line", "総武本線": "Sobu Main Line", "常磐線": "Joban Line",
    "横須賀線": "Yokosuka Line", "京浜東北線": "Keihin-Tohoku Line",
    "根岸線": "Negishi Line", "南武線": "Nambu Line", "武蔵野線": "Musashino Line",
    "京葉線": "Keiyo Line", "埼京線": "Saikyo Line", "横浜線": "Yokohama Line",
    "東西線": "Tozai Line", "大江戸線": "Oedo Line", "副都心線": "Fukutoshin Line",
    "上野東京ライン": "Ueno-Tokyo Line", "湘南新宿ライン": "Shonan-Shinjuku Line",
}

def romaji_line(kanji):
    """Readable English for a kanji line name with no curated translation,
    e.g. 上野東京ライン -> 'Ueno-Tokyo Line', 京王線 -> 'Keio Line'. The line
    suffix is mapped explicitly and the rest romanised (no long-vowel
    contraction — it mangles morpheme boundaries like 丸ノ内 'Marunouchi')."""
    if not kanji:
        return ""
    if kanji in CURATED_LINE:
        return CURATED_LINE[kanji]
    # The geojson often parenthesises the recognisable service name, e.g.
    # "4号線(中央線)" or "東北線（埼京線）" -> use the inner line.
    mp = re.search(r"[(（]([^)）]*線)[)）]", kanji)
    if mp:
        inner = mp.group(1)
        return CURATED_LINE.get(inner) or romaji_line(inner)
    if not _kks:
        return ""
    k = kanji.replace("・", " ")
    branch = ""
    for b in ("分岐線", "支線"):
        if k.endswith(b):
            branch = " (Branch)"; k = k[:-len(b)]; break
    suf = " Line" if branch else ""
    for jp_s, en_s in _LINE_SUFFIX:
        if k.endswith(jp_s):
            suf = en_s; k = k[:-len(jp_s)]; break
    k = re.sub(r"^\d+号線?", "", k)          # drop metro line-number prefix (4号線丸ノ内 -> 丸ノ内)
    if not k:
        return ""
    toks = [t["hepburn"] for t in _kks.convert(k) if t["hepburn"].strip()]
    body = " ".join(w[:1].upper() + w[1:] for w in toks)
    return (re.sub(r"\s+", " ", body).strip() + suf + branch).strip()

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
    lname = line.get("line_name_en") or line.get("line_name_kanji")
    for st in line["stations"]:
        if st["status"] != "Found": continue
        slug = st["jp_slug"]
        a = agg.setdefault(slug, {"name_full": None, "lines": set()})
        if st.get("name_full") and not a["name_full"]:
            a["name_full"] = st["name_full"]   # prefer the English line-page label
        if lname:
            a["lines"].add(lname)

stations=[]; by_code={}; slug2ekiline={}; n_eki=0; n_only=0; n_nodata=0
for slug, a in sorted(agg.items()):
    meta = jp.get(slug) or {}
    kcore = clean_kanji(meta.get("kanji"))
    lat, lon = meta.get("lat"), meta.get("lon")
    line_en = sorted(a["lines"])[0] if a["lines"] else ""
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
    # English name, in order of preference:
    #   1. English line-page label (clean, spaced)            — EN-page lines
    #   2. station page's curated "EN:" field                 — JP-only lines
    #   3. romanised kanji                                    — last resort
    if a["name_full"]:
        name_en = clean_en(a["name_full"])
    elif meta.get("en"):
        name_en = clean_en(meta["en"])
    else:
        name_en = romaji_kanji(m["name_kanji"] if m else kcore)
    rec = {
        "slug": slug,
        "name_kanji": (m["name_kanji"] if m else kcore),
        "name_en": name_en,
        "yomi": meta.get("yomi"),
        "lat": (m["lat"] if m else lat),
        "lon": (m["lon"] if m else lon),
        "lines": sorted(a["lines"]),
        "eki_code": (m["code"] if m else None),
        "eki_line": (m["line_code"] if m else None),
    }
    if rec["lat"] is None or rec["name_kanji"] is None:
        n_nodata+=1; continue               # cannot place on map
    if m: slug2ekiline[slug] = m["line_code"]
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

# Map each ekidata line (the kanji line_code used by the app) to Funakiya's
# properly spaced English line name. ekidata's own line_name_en is run-together
# (e.g. "Jrtokaidohonsen(Tokyo~Atami)").
#
# Source 1 (authoritative): the line registry, matching ekidata's kanji
# line_code to the Funakiya kanji line name. This is exact per-line and avoids
# the cross-contamination that coordinate matching can introduce at multi-line
# stations (e.g. a Marunouchi row picking up a JR station's vote).
def normln(k):
    return re.sub(r"[ 　]", "", k.replace("地下鉄", "")) if k else k
line_names = {}
try:
    reg = json.load(open("data/funakiya-lines.json", encoding="utf-8"))
    k2en = {normln(v["name_kanji"]): demacron(v["name_en"])
            for v in reg.values() if v.get("name_kanji") and v.get("name_en")}
    for g in eki:
        ln = g["line_name"]
        if normln(ln) in k2en:
            line_names[ln] = k2en[normln(ln)]
except FileNotFoundError:
    k2en = {}

# Source 2 (fallback): majority vote across a line's stamp stations. Fills
# segmented ekidata lines whose kanji has a (range) suffix the registry lacks,
# e.g. "JR東海道本線(東京～熱海)" -> "JR Tokaido Main Line(Tokyo - Atami)".
line_votes = defaultdict(Counter)
for line in raw["lines"]:
    en = demacron(line["line_name_en"] or "").strip()
    if not en: continue
    for st in line["stations"]:
        if st["status"] != "Found": continue
        ek = slug2ekiline.get(st["jp_slug"])
        if ek: line_votes[ek][en] += 1
for ek, cnt in line_votes.items():
    if ek not in line_names:
        line_names[ek] = cnt.most_common(1)[0][0]

# Source 3 (last resort): romanise the kanji line name for any remaining line,
# so the app never shows ekidata's run-together romaji (e.g. "Uenotokyorain").
for g in eki:
    ln = g["line_name"]
    if ln not in line_names:
        r = romaji_line(ln)
        if r and r != ln:
            line_names[ln] = r

# The map geometry (railroad-section.geojson) uses official *track* line names
# that mostly differ from the station data (e.g. "山手線", "東北本線",
# "4号線丸ノ内線"). Add English for those too so line hover tooltips are
# translated everywhere: curated where the kanji matches, else romanised.
try:
    geo = json.load(open("data/railroad-section.geojson", encoding="utf-8"))
    geonames = {f["properties"].get("路線名", "") for f in geo["features"]}
    for n in geonames:
        if not n or n in line_names:
            continue
        line_names[n] = k2en.get(normln(n)) or romaji_line(n)
except FileNotFoundError:
    pass

out={"source":"stamp.funakiya.com","count":len(stations),
     "line_names":line_names,"stations":stations}
json.dump(out, open("data/stamp-stations.json","w",encoding="utf-8"),
          ensure_ascii=False, indent=1)
matched = sum(1 for s in stations if s["eki_code"])
print(f"total stamp stations (deduped): {len(stations)}")
print(f"  matched to ekidata : {matched}")
print(f"  funakiya-only      : {len(stations)-matched}")
print(f"  dropped (no coords/kanji): {n_nodata}")
