#!/usr/bin/env python3
"""Stage 2: fetch each Funakiya per-station JP page for the authoritative
Japanese station name (kanji), reading (yomi) and exact coordinates.

The English line pages (stage 1) give the English name + Found status + the JP
page slug, but not kanji or coordinates. ekidata's English romanisation is
unreliable (e.g. 米原 Maibara is mis-romanised as "Yonehara"), so we match to
ekidata by KANJI, which requires fetching these pages.

Reads:  data/funakiya-raw.json
Writes: data/funakiya-stations.json   {slug: {kanji, yomi, lat, lon}}
"""
import html as htmlmod
import json, re, os, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
from concurrent.futures import ThreadPoolExecutor

BASE="https://stamp.funakiya.com"; CACHE="/tmp/funacache"
UA={"User-Agent":"Mozilla/5.0 (eki-stamp-tracker scraper; +github.com/txmnzia/eki-stamp-tracker)"}
os.makedirs(CACHE,exist_ok=True)

def fetch(slug):
    path=os.path.join(CACHE,f"jp-{slug}.html")
    if os.path.exists(path):
        return open(path,encoding="utf-8").read()
    for a in range(4):
        try:
            req=urllib.request.Request(f"{BASE}/{slug}.html",headers=UA)
            h=urllib.request.urlopen(req,timeout=30).read().decode("utf-8","replace")
            open(path,"w",encoding="utf-8").write(h)
            return h
        except Exception as e:
            if a==3:
                sys.stderr.write(f"FAIL {slug}: {e}\n"); return ""
            time.sleep(2**a)

def parse(slug,h):
    if not h: return None
    h = htmlmod.unescape(h) if "&" in h else h
    kanji=None; yomi=None
    # detailed template: 駅名称：<kanji>（[operator]）（<yomi>）  yomi = last paren
    m=re.search(r'駅名称：([^（(<]+?駅)((?:[（(][^）)]*[）)])+)',h)
    if m:
        kanji=m.group(1).strip()
        parens=re.findall(r'[（(]([^）)]*)[）)]',m.group(2))
        if parens: yomi=parens[-1].strip()
    else:
        # simple template (minor/private rail): kanji only in og:title
        # e.g. <meta property="og:title" content="阿武隈急行保原駅のスタンプ"/>
        o=re.search(r'<meta property="og:title" content="([^"]+?駅)(?:[（(][^"]*)?のスタンプ"',h)
        if o: kanji=o.group(1).strip()
    geo=re.search(r'Geo URI[：:]\s*([0-9]+\.[0-9]+)[^0-9]+([0-9]+\.[0-9]+)',h)
    lat=float(geo.group(1)) if geo else None
    lon=float(geo.group(2)) if geo else None
    # curated English name, e.g. "EN: Keisei Keisei-Ueno Station"
    e=re.search(r'EN:\s*([^<\n]+?Station)\b',h)
    en=e.group(1).strip() if e else None
    return {"kanji":kanji,"yomi":yomi,"lat":lat,"lon":lon,"en":en}

def main():
    raw=json.load(open(os.path.join(DATA,"funakiya-raw.json"),encoding="utf-8"))
    slugs=sorted({s["jp_slug"] for l in raw["lines"] for s in l["stations"]
                  if s["status"]=="Found" and s["jp_slug"]})
    print(f"fetching {len(slugs)} JP pages ...")
    out={}; done=[0]
    def work(slug):
        d=parse(slug,fetch(slug)); time.sleep(0.05)
        done[0]+=1
        if done[0]%200==0: print(f"  {done[0]}/{len(slugs)}")
        return slug,d
    with ThreadPoolExecutor(max_workers=6) as ex:
        for slug,d in ex.map(work,slugs):
            if d: out[slug]=d
    miss=[s for s in slugs if not out.get(s) or not out[s].get("kanji")]
    json.dump(out,open(os.path.join(DATA,"funakiya-stations.json"),"w",encoding="utf-8"),ensure_ascii=False,indent=1)
    print(f"wrote data/funakiya-stations.json: {len(out)} stations; {len(miss)} missing kanji")
    if miss[:10]: print("  missing sample:",miss[:10])

if __name__=="__main__": main()
