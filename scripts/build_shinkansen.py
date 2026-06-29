#!/usr/bin/env python3
"""Build data/shinkansen.json — a curated Shinkansen layer for the ride feature.

ekidata's stations.json has no Shinkansen lines at all, so the app can't derive
Shinkansen stops the normal way. This script curates each Shinkansen's ordered
stops, resolves their coordinates from the station data (falling back to a small
manual table for Shinkansen-only stations), and writes a clean per-line list.
The app uses these stops for the ride picker and as anchors for the drawn line;
to draw it the app FOLLOWS the bundled track geometry (railroad-section.geojson)
where it exists — fragmented per line but present for most of each route — and
snaps these curated stops onto it (see shinkansenPath in index.html). Station
coordinates match the conventional-station records, so collected-stamp matching
(by name+location) just works.

Run: python3 scripts/build_shinkansen.py
"""
import json, math, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def load(p): return json.load(open(os.path.join(ROOT, 'data', p)))

stations = load('stations.json')
stamp    = load('stamp-stations.json')

def norm(k): return (k or '').replace('ヶ', 'ケ')

# kanji -> [ (lat, lon, code), ... ] ALL occurrences (names like 新富士/川内 repeat
# across regions, so we can't just take the first — see resolve_path below).
coord_all = {}
for g in stations:
    for s in g['stations']:
        if s.get('lat') and s.get('lon'):
            coord_all.setdefault(norm(s['name_kanji']), []).append((s['lat'], s['lon'], s['code']))
coord = {k: v[0] for k, v in coord_all.items()}   # first occurrence (English lookup only)

# curated English by kanji (network qualifier stripped) from stamp stations
def clean_en(en): return re.sub(r'^(Toei Subway|Tokyo Metro)\s+', '', en or '')
curated_en = {}
for s in stamp['stations']:
    if s.get('name_en'):
        curated_en.setdefault(norm(s['name_kanji']), clean_en(s['name_en']))
eki_en = {}
for g in stations:
    for s in g['stations']:
        eki_en.setdefault(norm(s['name_kanji']), s.get('name_en'))

# Shinkansen-only stations not present in the station data: lat, lon, English.
MANUAL = {
 '岐阜羽島': (35.3155, 136.6866, 'Gifu-Hashima'),
 '新尾道':   (34.4351, 133.2179, 'Shin-Onomichi'),
 '東広島':   (34.4268, 132.7430, 'Higashi-Hiroshima'),
 '新岩国':   (34.1510, 132.1690, 'Shin-Iwakuni'),
 '白石蔵王': (38.0023, 140.6157, 'Shiroishi-Zao'),
 'くりこま高原': (38.7003, 141.0664, 'Kurikoma-Kogen'),
 '水沢江刺': (39.1230, 141.1830, 'Mizusawa-Esashi'),
 '七戸十和田': (40.7061, 141.1690, 'Shichinohe-Towada'),
 '本庄早稲田': (36.2127, 139.1463, 'Honjo-Waseda'),
 '上毛高原': (36.6772, 138.9990, 'Jomo-Kogen'),
 '安中榛名': (36.3430, 138.8570, 'Annaka-Haruna'),
 '新大牟田': (33.0120, 130.4480, 'Shin-Omuta'),
 '新玉名':   (32.9160, 130.5940, 'Shin-Tamana'),
 '越前たけふ': (35.8720, 136.2180, 'Echizen-Takefu'),
 '黒部宇奈月温泉': (36.8460, 137.4340, 'Kurobe-Unazuki-Onsen'),
 # Shinkansen-only stations that ALSO have a same-named conventional station in a
 # different region (so the station data resolves to the wrong one) — pin them here.
 '新富士': (35.1424, 138.6607, 'Shin-Fuji'),   # Shizuoka (not the Hokkaidō 新富士)
}
# Clean English for major Shinkansen stops where ekidata romaji is poor.
EN_OVERRIDE = {
 '東京':'Tokyo','品川':'Shinagawa','新横浜':'Shin-Yokohama','小田原':'Odawara','熱海':'Atami',
 '三島':'Mishima','新富士':'Shin-Fuji','静岡':'Shizuoka','掛川':'Kakegawa','浜松':'Hamamatsu',
 '豊橋':'Toyohashi','三河安城':'Mikawa-Anjo','名古屋':'Nagoya','米原':'Maibara','京都':'Kyoto',
 '新大阪':'Shin-Osaka','新神戸':'Shin-Kobe','西明石':'Nishi-Akashi','姫路':'Himeji','相生':'Aioi',
 '岡山':'Okayama','新倉敷':'Shin-Kurashiki','福山':'Fukuyama','三原':'Mihara','広島':'Hiroshima',
 '徳山':'Tokuyama','新山口':'Shin-Yamaguchi','厚狭':'Asa','新下関':'Shin-Shimonoseki','小倉':'Kokura',
 '博多':'Hakata','上野':'Ueno','大宮':'Omiya','小山':'Oyama','宇都宮':'Utsunomiya',
 '那須塩原':'Nasu-Shiobara','新白河':'Shin-Shirakawa','郡山':'Koriyama','福島':'Fukushima',
 '仙台':'Sendai','古川':'Furukawa','一ノ関':'Ichinoseki','北上':'Kitakami','新花巻':'Shin-Hanamaki',
 '盛岡':'Morioka','いわて沼宮内':'Iwate-Numakunai','二戸':'Ninohe','八戸':'Hachinohe','新青森':'Shin-Aomori',
 '熊谷':'Kumagaya','高崎':'Takasaki','越後湯沢':'Echigo-Yuzawa','浦佐':'Urasa','長岡':'Nagaoka',
 '燕三条':'Tsubame-Sanjo','新潟':'Niigata','軽井沢':'Karuizawa','佐久平':'Sakudaira','上田':'Ueda',
 '長野':'Nagano','飯山':'Iiyama','上越妙高':'Joetsumyoko','糸魚川':'Itoigawa','富山':'Toyama',
 '新高岡':'Shin-Takaoka','金沢':'Kanazawa','小松':'Komatsu','加賀温泉':'Kaga-Onsen',
 '芦原温泉':'Awara-Onsen','福井':'Fukui','敦賀':'Tsuruga','新鳥栖':'Shin-Tosu','久留米':'Kurume',
 '筑後船小屋':'Chikugo-Funagoya','熊本':'Kumamoto','新八代':'Shin-Yatsushiro','新水俣':'Shin-Minamata',
 '出水':'Izumi','川内':'Sendai (Kagoshima)','鹿児島中央':'Kagoshima-Chuo',
 '奥津軽いまべつ':'Oku-Tsugaru-Imabetsu','木古内':'Kikonai','新函館北斗':'Shin-Hakodate-Hokuto',
}

LINES = [
 ('東海道新幹線', 'Tokaido Shinkansen', '#0072BC',
  "東京 品川 新横浜 小田原 熱海 三島 新富士 静岡 掛川 浜松 豊橋 三河安城 名古屋 岐阜羽島 米原 京都 新大阪"),
 ('山陽新幹線', 'Sanyo Shinkansen', '#0072BC',
  "新大阪 新神戸 西明石 姫路 相生 岡山 新倉敷 福山 新尾道 三原 東広島 広島 新岩国 徳山 新山口 厚狭 新下関 小倉 博多"),
 ('東北新幹線', 'Tohoku Shinkansen', '#22B14C',
  "東京 上野 大宮 小山 宇都宮 那須塩原 新白河 郡山 福島 白石蔵王 仙台 古川 くりこま高原 一ノ関 水沢江刺 北上 新花巻 盛岡 いわて沼宮内 二戸 八戸 七戸十和田 新青森"),
 ('上越新幹線', 'Joetsu Shinkansen', '#F7941E',
  "東京 上野 大宮 熊谷 本庄早稲田 高崎 上毛高原 越後湯沢 浦佐 長岡 燕三条 新潟"),
 ('北陸新幹線', 'Hokuriku Shinkansen', '#E4007F',
  "東京 上野 大宮 高崎 安中榛名 軽井沢 佐久平 上田 長野 飯山 上越妙高 糸魚川 黒部宇奈月温泉 富山 新高岡 金沢 小松 加賀温泉 芦原温泉 福井 越前たけふ 敦賀"),
 ('九州新幹線', 'Kyushu Shinkansen', '#EE2737',
  "博多 新鳥栖 久留米 筑後船小屋 新大牟田 新玉名 熊本 新八代 新水俣 出水 川内 鹿児島中央"),
 ('北海道新幹線', 'Hokkaido Shinkansen', '#9CDCF7',
  "新青森 奥津軽いまべつ 木古内 新函館北斗"),
]

def resolve_en(k):
    # EN_OVERRIDE (major stops) → MANUAL (Shinkansen-only) → curated stamp → ekidata.
    return EN_OVERRIDE.get(k) or (MANUAL[k][2] if k in MANUAL else None) or curated_en.get(norm(k)) or eki_en.get(norm(k)) or k

def md(a, b):
    sx = 111320 * math.cos(math.radians((a[0]+b[0])/2)); sy = 110540
    return math.hypot((a[0]-b[0])*sy, (a[1]-b[1])*sx)

def candidates(nm):
    cs = list(coord_all.get(norm(nm), []))
    if nm in MANUAL:
        lat, lon, _ = MANUAL[nm]; cs.append((lat, lon, 'shk_' + norm(nm)))
    return cs

def resolve_path(stop_names):
    """Pick one coordinate per stop so the whole sequence is geographically
    continuous (Viterbi: minimise total stop-to-stop distance). Fixes duplicate
    names like 新富士 (Shizuoka vs Hokkaidō) and 川内 (Kagoshima vs Aomori)."""
    cands = [candidates(nm) for nm in stop_names]
    for nm, cs in zip(stop_names, cands):
        if not cs: raise SystemExit(f'No coordinate for {nm}')
    dp = [[ (0, -1) for _ in cs ] for cs in cands]
    for i in range(1, len(cands)):
        for ci, c in enumerate(cands[i]):
            best, bj = None, -1
            for cj, p in enumerate(cands[i-1]):
                cost = dp[i-1][cj][0] + md((p[0], p[1]), (c[0], c[1]))
                if best is None or cost < best: best, bj = cost, cj
            dp[i][ci] = (best, bj)
    last = min(range(len(cands[-1])), key=lambda ci: dp[-1][ci][0])
    chosen = [None]*len(cands); ci = last
    for i in range(len(cands)-1, -1, -1):
        chosen[i] = cands[i][ci]; ci = dp[i][ci][1]
    return chosen

out = {}
for kanji, en, color, stops in LINES:
    names = stops.split()
    picks = resolve_path(names)
    arr = []
    for nm, (lat, lon, code) in zip(names, picks):
        arr.append({'name_kanji': nm, 'name_en': resolve_en(nm), 'lat': round(lat, 6), 'lon': round(lon, 6), 'code': code})
    # sanity: total chord length and worst single hop
    total = sum(md((arr[i-1]['lat'], arr[i-1]['lon']), (arr[i]['lat'], arr[i]['lon'])) for i in range(1, len(arr)))
    hops = [(arr[i-1]['name_kanji']+'→'+arr[i]['name_kanji'], round(md((arr[i-1]['lat'], arr[i-1]['lon']), (arr[i]['lat'], arr[i]['lon']))/1000)) for i in range(1, len(arr))]
    worst = max(hops, key=lambda x: x[1])
    print(f'{kanji:8} {len(arr):2} stops  {total/1000:4.0f}km chord  worst hop {worst}')
    bad = [h for h in hops if h[1] > 100]   # no real Shinkansen hop is this long
    if bad: raise SystemExit(f'  !! suspicious hop(s) on {kanji} (likely wrong coord): {bad}')
    out[kanji] = {'name_en': en, 'color': color, 'stations': arr}

with open(os.path.join(ROOT, 'data', 'shinkansen.json'), 'w') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print('wrote data/shinkansen.json')
