#!/usr/bin/env python3
"""Collect each line's English + Japanese (kanji) name, and audit completeness.

- English name: from the English line-page title (already in funakiya-raw.json).
- Kanji name:   from the Japanese line page og:title (/<slug>.html), e.g.
                "JR山手線のスタンプ" -> "JR山手線".
- Completeness: BFS the Japanese railway index to find any line that has no
  English page (and is therefore absent from our English-derived dataset).

Writes: data/funakiya-lines.json  {slug: {name_en, name_kanji}}
"""
import html as htmlmod
import json, re, os, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
from concurrent.futures import ThreadPoolExecutor

BASE="https://stamp.funakiya.com"; CACHE="/tmp/funacache"
UA={"User-Agent":"Mozilla/5.0 (eki-stamp-tracker scraper; +github.com/txmnzia/eki-stamp-tracker)"}
RAILY=re.compile(r'jr|tetsu|line|subway|metro|toei|railway|dentetsu|kotsu|'
                 r'monorail|express|shinkansen|liner|rinkai|yurikamome|cablecar|ropeway')

def get(url, key=None):
    p=os.path.join(CACHE,key) if key else None
    if p and os.path.exists(p): return open(p,encoding="utf-8").read()
    for a in range(4):
        try:
            h=urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=30).read().decode("utf-8","replace")
            if p: open(p,"w",encoding="utf-8").write(h)
            time.sleep(0.05); return h
        except Exception as e:
            if a==3: return ""
            time.sleep(2**a)

def jp_line_kanji(slug):
    h=get(f"{BASE}/{slug}.html", f"jpline-{slug}.html")
    m=re.search(r'<meta property="og:title" content="([^"]+?)(?:[（(][^"]*)?のスタンプ"',h)
    return htmlmod.unescape(m.group(1)).strip() if m else None

def en_line_name(slug):
    """English line name from the EN line-page title (even for all-None lines
    such as Tokyo Metro / Toei that carry no stamps)."""
    h=get(f"{BASE}/en/{slug}.html", f"line-{slug}.html")
    m=re.search(r'<title>([^<]*)</title>',h)
    if not m: return None
    t=re.sub(r'\s*-\s*Funakiya.*$','',htmlmod.unescape(m.group(1))).replace(' Stamps','').strip()
    return t or None

def enumerate_jp_lines():
    seeds=['/','/train.html','/pref/']+[f'/pref/train-{r}.html' for r in
      ['hokkaido','tohoku','kanto','koshinetsu','hokuriku','tokai','kinki','chugoku','shikoku','kyushu']]
    visited=set(); lines=set(); frontier=list(seeds)
    for _ in range(5):
        nxt=[]
        for pth in frontier:
            if pth in visited: continue
            visited.add(pth); h=get(f"{BASE}{pth}")
            for sl in re.findall(r'href="https://stamp\.funakiya\.com/([a-z0-9-]+)\.html"',h):
                if sl.endswith('-line'): lines.add(sl)
                elif f"/{sl}.html" not in visited and RAILY.search(sl):
                    nxt.append(f"/{sl}.html")
        frontier=nxt
    return lines

def main():
    raw=json.load(open(os.path.join(DATA,"funakiya-raw.json"),encoding="utf-8"))
    en_names={l["line_slug"]: l["line_name_en"] for l in raw["lines"]}
    print("enumerating JP line pages for completeness audit ...")
    jp_lines=enumerate_jp_lines()
    en_lines=set(en_names)
    jp_only=sorted(jp_lines - en_lines)
    print(f"JP railway line pages: {len(jp_lines)}; in our dataset: {len(en_lines)}")
    print(f"JP-only lines (no English page, NOT scraped): {len(jp_only)}")
    for s in jp_only[:40]: print("   ", s)

    # kanji names for every line we use (+ jp-only, for reference)
    all_slugs=sorted(en_lines | jp_lines)
    print(f"fetching kanji names for {len(all_slugs)} line pages ...")
    out={}; done=[0]
    def work(sl):
        k=jp_line_kanji(sl); e=en_line_name(sl) or en_names.get(sl); done[0]+=1
        if done[0]%100==0: print(f"  {done[0]}/{len(all_slugs)}")
        return sl,k,e
    with ThreadPoolExecutor(max_workers=6) as ex:
        for sl,k,e in ex.map(work, all_slugs):
            out[sl]={"name_en": e, "name_kanji": k}
    json.dump(out, open(os.path.join(DATA,"funakiya-lines.json"),"w",encoding="utf-8"),
              ensure_ascii=False, indent=1)
    miss=[s for s,v in out.items() if not v["name_kanji"]]
    print(f"wrote data/funakiya-lines.json: {len(out)} lines, {len(miss)} missing kanji")

if __name__=="__main__": main()
