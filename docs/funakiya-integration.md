# Funakiya stamp data — integration plan

Working notes for sourcing **per-station eki-stamp truth** from
funakiya.com. Written before the scrape could run (the domain was blocked
by the web session's network policy). Pick this up in a session that has
network access to `stamp.funakiya.com`.

## Goal

Replace the coarse, guessed line-level exclusion (`data/no-stamps-lines.json`)
with an accurate **per-station `has_stamp` flag** sourced from funakiya, and
render map markers from that flag.

## Why the current state is wrong

- Commit `1f134eb` ("exclude stamp-free lines from station display") added 70
  lines to `data/no-stamps-lines.json`. `index.html` skips rendering any
  station whose `line_code` is in that list (see `renderStations`, ~line 1430).
- That hid **1,229 stations** based on *operator-level generalizations*, not
  per-station facts.
- Concrete failure: the Keio Takao Line (`京王高尾線`) was excluded under
  "Keio = no stamp programme", which hid **Takaosanguchi (高尾山口)** and its 6
  neighbours. funakiya in fact has many `keio-*.html` station pages
  (Shinjuku, Chōfu, Hatsudai, Hatagaya, Yomiuriland, …), so Keio stamps exist.
- **No stations were ever deleted** from `data/stations.json` — they are only
  hidden. Takaosanguchi is still present: code `eki_2400307`, line `京王高尾線`.

## Source of truth: stamp.funakiya.com ("旅のスタンプ帳")

Hand-maintained static HTML catalog of Japanese eki stamps. Useful structure:

- English mirror: `/en/`
- National / regional indexes: `/en/train.html`, `/en/pref/train-kinki.html`,
  prefecture pages like `/en/tokyo-jr.html`
- **Per-operator stamp index** (good crawl entry point):
  `/mintetsu/{operator}/` — e.g. `/mintetsu/keio/`, `/mintetsu/meitetsu/`
- Per-line list pages: `/en/keisei-main-line.html`, `/en/jr-kobe-line.html`
- **Per-station pages**: `{operator}-{station}.html`
  (e.g. `keio-takaosanguchi.html`, `jr-shinjuku.html`)
- No public API / JSON / export. Scrape only.

## CRITICAL parsing rule

**A station page existing does NOT mean the station has a stamp.** funakiya
documents stations both *with* and *without* stamps. Only the **page content**
is authoritative — parse the body for the stamp-present vs. stamp-absent state
(Japanese あり / なし, "設置されていません", etc.). Do **not** infer presence
from URL existence or from a link appearing on an index page.

→ First action in the access-enabled session: fetch one known page
(`stamp.funakiya.com/mintetsu/keio/` and a station page) and confirm the exact
markup that distinguishes "has stamp" from "no stamp" before writing the parser.

## Plan

1. Crawl `/mintetsu/{operator}/` indexes (+ JR/region indexes) to enumerate
   candidate station-page URLs.
2. Fetch each station page and **parse the body** to decide `has_stamp`
   (true/false/unknown). Capture station kanji name + operator/line from the
   page (title pattern: `{station}（{operator}）のスタンプ`).
3. Match each funakiya station to our ekidata station by
   (`line_code` / operator + `name_kanji`); record unmatched for manual review.
4. Emit `data/stamp-stations.json` keyed by our station `code` → `has_stamp`.
5. Rework `index.html` to render markers from the per-station flag and retire
   `data/no-stamps-lines.json`. Keep the IndexedDB cache (`eki_stations`) in
   mind — bump its shape/key so stale cached exclusions don't linger.

## Network access (how to unblock)

Web session network policy defaults to **Trusted**, which blocks funakiya.
Edit the environment → **Network access** → **Custom** → add
`stamp.funakiya.com` (or `*.funakiya.com`); keep "Also include default list of
common package managers" checked. Applies to **new sessions** only.
