#!/usr/bin/env python3
"""Scrape eki-stamp data from Funakiya's Travel Stamp Book (stamp.funakiya.com).

Each railway line has a page listing every station on it, with a stamp status
marker (✓ Found / － None / △ Another station / ★ Event Only) and a link to the
per-station page. A station has a real stamp iff it is marked "Found".

Most lines have an English page (/en/<slug>.html) with properly spaced English
station names; some exist only in Japanese (/<slug>.html). We enumerate the
*union* of both index trees (English crawls miss lines, and vice-versa), then
for each line use its English page when it exists (clean English names),
falling back to the Japanese page otherwise (names are recovered downstream
from each station's own page / romanisation).

The status marker is read from the CSS class (lo00=None, lo01=Found,
lo02=Another station, lo03=Event Only), which is identical on EN and JP pages.

Output: data/funakiya-raw.json
"""
import json, re, time, os, sys, urllib.request

BASE = "https://stamp.funakiya.com"
CACHE = "/tmp/funacache"
REGIONS = ["hokkaido","tohoku","kanto","koshinetsu","hokuriku","tokai",
           "kinki","chugoku","shikoku","kyushu"]
UA = {"User-Agent":"Mozilla/5.0 (eki-stamp-tracker scraper; +https://github.com/txmnzia/eki-stamp-tracker)"}
RAILY = re.compile(r'jr|tetsu|line|subway|metro|toei|railway|dentetsu|kotsu|'
                   r'monorail|express|shinkansen|liner|rinkai|yurikamome|cablecar|ropeway')
STATUS = {"0":"None","1":"Found","2":"Another station","3":"Event Only"}

os.makedirs(CACHE, exist_ok=True)

def get(url, cache_key=None):
    path = os.path.join(CACHE, cache_key) if cache_key else None
    if path and os.path.exists(path):
        return open(path, encoding="utf-8").read()
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers=UA)
            html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8","replace")
            if path:
                open(path,"w",encoding="utf-8").write(html)
            time.sleep(0.12)
            return html
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return ""              # missing page — don't retry
            if attempt == 4:
                print(f"  FAIL {url}: {e}", file=sys.stderr); return ""
            time.sleep(2**attempt)
        except Exception as e:
            if attempt == 4:
                print(f"  FAIL {url}: {e}", file=sys.stderr)
                return ""
            time.sleep(2**attempt)

def _crawl(prefix):
    """BFS one index tree (prefix '/en' or '') and return its -line slugs."""
    seeds = [f"{prefix}/", f"{prefix}/train.html"] + \
            [f"{prefix}/pref/train-{r}.html" for r in REGIONS]
    visited, lines, indexes = set(), set(), set()
    frontier = list(seeds)
    for _ in range(5):
        nxt = []
        for p in frontier:
            if p in visited:
                continue
            visited.add(p)
            key = "idx-" + re.sub(r'[^a-z0-9]+', '_', p.strip('/')) + ".html"
            html = get(f"{BASE}{p}", key)
            # EN links live under /en/<slug>.html; JP links are /<slug>.html
            # (directly after the host, never under /en/).
            pat = (r'stamp\.funakiya\.com/en/([a-z0-9-]+)\.html' if prefix
                   else r'stamp\.funakiya\.com/([a-z0-9-]+)\.html')
            for sl in re.findall(pat, html):
                if sl.endswith("-line"):
                    lines.add(sl)
                elif sl not in indexes and RAILY.search(sl):
                    indexes.add(sl); nxt.append(f"{prefix}/{sl}.html")
        frontier = nxt
    return lines

def enumerate_lines():
    """Complete set of line slugs.

    The line registry (data/funakiya-lines.json) is the authoritative complete
    list (built by scrape_funakiya_lines.py, which crawls both the EN and JP
    index trees). We use it as the backbone so a flaky live crawl can never
    drop a line, and additionally run the fast EN crawl to pick up any line
    added since the registry was generated. parse_line() then probes the EN
    page for each slug directly, so we don't need to know here which lines
    have English pages.
    """
    slugs = _crawl("/en")                     # fast, catches newly-added EN lines
    try:
        slugs |= set(json.load(open("data/funakiya-lines.json", encoding="utf-8")))
    except FileNotFoundError:
        print("  WARNING: data/funakiya-lines.json missing; run "
              "scrape_funakiya_lines.py first for full coverage", file=sys.stderr)
        slugs |= _crawl("")                   # fall back to live JP crawl
    print(f"  total lines: {len(slugs)}")
    return sorted(slugs)

def parse_stations(html, lang):
    """Extract station entries from a line page (EN or JP).

    Each <li> anchors either to the station's detail page (<a href="...">,
    giving a jp_slug we later fetch for kanji/coords) or, for stamps that have
    no detail page yet, to an in-page bookmark (<a name="04">, no slug).

    Titles may carry a trailing station-number suffix, e.g. on subway lines
    "Toei Subway Shinjuku-nishiguchi Station stamp (E01)" — that parenthetical
    must be stripped before matching, otherwise whole lines (the entire Toei
    Oedo/Mita/Shinjuku/Asakusa subways) are silently dropped."""
    out = []
    for ul in re.findall(r'<ul class="allArticleList[^"]*">(.*?)</ul>', html, re.S):
        for href, inner in re.findall(
                r'<li>\s*<a (?:href="([^"]*)"|name="[^"]*")>(.*?)</a>\s*</li>',
                ul, re.S):
            # closing tag is sometimes malformed in the source (e.g.
            # "<h3 class="title">JNR Rumoi Station stamp</h4>"), so accept any </hN>
            h3 = re.search(r'<h3 class="title">([^<]*)</h\d>', inner)
            if not h3:
                continue
            name = h3.group(1).strip()
            if lang == "en":
                m = re.match(r'(.*Station) stamp(?:\s*[（(][^）)]+[）)])?\s*$', name)
                if not m:
                    continue
                name_en, name_kanji = m.group(1).strip(), None
            else:
                m = re.match(r'(.+?駅)のスタンプ(?:\s*[（(][^）)]+[）)])?\s*$', name)
                if not m:
                    continue
                name_en, name_kanji = None, m.group(1).strip()
            cls = re.search(r'<span class="lo0(\d)"', inner)
            slug = href.split("/")[-1].replace(".html", "") if href else None
            out.append({
                "jp_slug": slug,             # None when the stamp has no detail page
                "name_full": name_en,        # English label incl. "Station" (EN pages only)
                "name_kanji": name_kanji,    # kanji label incl. "駅" (JP pages only)
                "status": STATUS.get(cls.group(1), "") if cls else "",
            })
    return out

def title_of(html):
    t = re.search(r'<title>([^<]*)</title>', html)
    return (t.group(1) if t else "")

def parse_line(slug):
    """Always prefer the English page (clean English names) when it exists;
    fall back to the Japanese page otherwise. Trying EN unconditionally avoids
    depending on the (fallible) enumeration to know which lines have EN pages."""
    html = get(f"{BASE}/en/{slug}.html", f"line-{slug}.html")
    st = parse_stations(html, "en")
    if st:
        name = re.sub(r'\s*-\s*Funakiya.*$', '', title_of(html)).replace(" Stamps", "").strip()
        return {"line_slug": slug, "line_name_en": name, "src": "en", "stations": st}
    html = get(f"{BASE}/{slug}.html", f"jpline-{slug}.html")
    st = parse_stations(html, "jp")
    if st:
        name = re.sub(r'のスタンプ.*$', '', title_of(html)).strip()
        return {"line_slug": slug, "line_name_en": None, "line_name_kanji": name,
                "src": "jp", "stations": st}
    return None

def main():
    slugs = enumerate_lines()
    print(f"Enumerated {len(slugs)} line pages")
    lines = []
    for i, slug in enumerate(slugs, 1):
        d = parse_line(slug)
        if d and any(s["status"] == "Found" for s in d["stations"]):
            lines.append(d)
        if i % 50 == 0:
            print(f"  {i}/{len(slugs)} ...")
    total = sum(s["status"] == "Found" for l in lines for s in l["stations"])
    out = {"source": "stamp.funakiya.com", "lines": lines}
    os.makedirs("data", exist_ok=True)
    json.dump(out, open("data/funakiya-raw.json","w",encoding="utf-8"),
              ensure_ascii=False, indent=1)
    n_jp = sum(1 for l in lines if l["src"] == "jp")
    print(f"Wrote data/funakiya-raw.json: {len(lines)} lines "
          f"({n_jp} JP-only), {total} Found station entries")

if __name__ == "__main__":
    main()
