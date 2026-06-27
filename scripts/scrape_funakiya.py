#!/usr/bin/env python3
"""Scrape eki-stamp data from Funakiya's Travel Stamp Book (stamp.funakiya.com).

The site's English line pages (/en/<line>-line.html) list every station on a
line that has a commemorative stamp, with a properly spaced English name and a
link to the Japanese per-station page. Presence on a line page == the station
has a stamp. We crawl all English line pages (enumerated from the English
regional railway summaries) and emit a raw dataset for downstream matching.

Output: data/funakiya-raw.json
"""
import json, re, time, os, sys, urllib.request

BASE = "https://stamp.funakiya.com"
CACHE = "/tmp/funacache"
REGIONS = ["hokkaido","tohoku","kanto","koshinetsu","hokuriku","tokai",
           "kinki","chugoku","shikoku","kyushu"]
UA = {"User-Agent":"Mozilla/5.0 (eki-stamp-tracker scraper; +https://github.com/txmnzia/eki-stamp-tracker)"}

def get(url, cache_key=None):
    path = os.path.join(CACHE, cache_key) if cache_key else None
    if path and os.path.exists(path):
        return open(path, encoding="utf-8").read()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8","replace")
            if path:
                open(path,"w",encoding="utf-8").write(html)
            time.sleep(0.15)
            return html
        except Exception as e:
            if attempt == 3:
                print(f"  FAIL {url}: {e}", file=sys.stderr)
                return ""
            time.sleep(2**attempt)

def enumerate_line_pages():
    slugs = set()
    for r in REGIONS:
        html = get(f"{BASE}/en/pref/train-{r}.html", f"region-{r}.html")
        for m in re.findall(r'href="https://stamp\.funakiya\.com/en/([a-z0-9-]+-line)\.html"', html):
            slugs.add(m)
    return sorted(slugs)

def parse_line(slug):
    html = get(f"{BASE}/en/{slug}.html", f"line-{slug}.html")
    if not html:
        return None
    title = re.search(r'<title>([^<]*)</title>', html)
    line_name = (title.group(1) if title else slug)
    line_name = re.sub(r'\s*-\s*Funakiya.*$','',line_name).replace(" Stamps","").strip()
    stations = []
    for ul in re.findall(r'<ul class="allArticleList[^"]*">(.*?)</ul>', html, re.S):
        for href, inner in re.findall(r'<li>\s*<a href="([^"]+)">(.*?)</a>\s*</li>', ul, re.S):
            h3 = re.search(r'<h3 class="title">([^<]*)</h3>', inner)
            if not h3:
                continue
            name = h3.group(1).strip()
            if not name.endswith("Station stamp"):
                continue  # skip related-link/summary entries
            # status marker: ≪✓:Found≫ / ≪－:None≫ / ≪△:Another station≫ / ≪★:Event Only≫
            st = re.search(r'<span class="lo0\d">≪.:([A-Za-z ]+)≫', inner)
            stations.append({
                "jp_slug": href.split("/")[-1].replace(".html",""),
                "name_full": name[:-len(" stamp")].strip(),   # "JR Tennōji Station"
                "status": (st.group(1).strip() if st else ""),
            })
    return {"line_slug": slug, "line_name_en": line_name, "stations": stations}

def main():
    slugs = enumerate_line_pages()
    print(f"Enumerated {len(slugs)} English line pages")
    lines = []
    for i, slug in enumerate(slugs, 1):
        d = parse_line(slug)
        if d and d["stations"]:
            lines.append(d)
        if i % 50 == 0:
            print(f"  {i}/{len(slugs)} ...")
    total = sum(len(l["stations"]) for l in lines)
    out = {"source": "stamp.funakiya.com", "lines": lines}
    os.makedirs("data", exist_ok=True)
    json.dump(out, open("data/funakiya-raw.json","w",encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"Wrote data/funakiya-raw.json: {len(lines)} lines, {total} station entries")

if __name__ == "__main__":
    main()
