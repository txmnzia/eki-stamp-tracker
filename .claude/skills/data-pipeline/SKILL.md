---
name: data-pipeline
description: Regenerating and validating the shipped data files in data/ — scraper→build pipeline order, join rules, determinism status, and ship discipline. Use when touching anything in data/ or scripts/*.py, refreshing railroad-section.geojson from upstream, re-scraping Funakiya, running check_data.py, investigating wrong/missing station names or stamps, or preparing a data release (APP_VERSION bump).
---

# Data pipeline: regenerate & validate

`data/` is shipped verbatim to every client (static app, no server). Every
regen is a release. Background: README "Regenerating data" + "Key data shapes";
`docs/AUDIT-2026-07.md` Blocks 3–5 for the history behind each rule.

## Quick reference — files and shapes (all verified against the shipped data)

| File | Shape | Role |
|---|---|---|
| `data/stations.json` | array of 591 line groups `{line_name, line_name_en, stations:[{code, name_kanji, name_en, lat, lon, line_code}]}`; 10,452 stations, codes unique, **already in geographic order** | ekidata; authoritative station lists + order for the ride feature |
| `data/stamp-stations.json` | `{source, count:2411, line_names:{kanji→EN, 1062 entries}, stations:[{slug, name_kanji, name_en, yomi, lat, lon, lines, eki_code, eki_line, code}]}` | curated stamp catalogue; drives which markers appear + curated EN names |
| `data/railroad-section.geojson` | FeatureCollection, 22,016 LineString features, properties `鉄道区分/事業者種別/路線名/運営会社`; 581 distinct 路線名 | track geometry; one line = many segments sharing a 路線名 |
| `data/rail-graph.json` | `{source, node_count:20718, edge_count:22015, edge_format, lines:[581], nodes:[[lat,lon]], edges:[[u,v,len_m,feat,line_idx]], stations:{code:[node,snap_m], 2341}, far:[84]}` | precomputed national routing graph (future v2 work; not used by the app at runtime) |
| `data/shinkansen.json` | `{路線名: {name_en, color, stations:[{name_kanji, name_en, lat, lon, code}]}}`, 8 lines; 17 stops use synthetic `shk_*` codes | curated Shinkansen stops (ekidata has none) |
| `data/funakiya-raw.json` | `{source, lines:[499 {line_slug, line_name_en/kanji, src, stations:[{jp_slug, name_full, name_kanji, status}]}]}` | stage-1 scrape (line pages + Found status) |
| `data/funakiya-stations.json` | `{slug: {kanji, yomi, lat, lon, en}}`, 2,686 entries | stage-2 scrape (per-station kanji/coords) |
| `data/funakiya-lines.json` | `{slug: {name_en, name_kanji}}`, 547 entries | stage-3 line-name registry (curated EN/kanji line names) |

**Join rules (MUST):**
- `stamp-stations.stations[].eki_code` → `stations.json` station `.code`. That
  is the ONLY stamps↔ekidata join. 84 entries have `eki_code: null` (defunct
  JNR/third-sector lines); they carry `fk_*` codes and render from their own
  records (`js/markers.js` Pass D) — they are NOT orphans to be "fixed"
  (AUDIT 4.1: they used to be silently undisplayable).
- **NEVER join stations↔geojson by line name.** Measured dead end: 57/390
  exact, 149/390 normalized (`docs/HANDOVER-line-highlight.md`). They meet
  only spatially (see the geometry-pipeline skill).

## Validate (run this first, and before any ship)

```sh
python3 scripts/check_data.py
# all data checks passed: 10452 stations, 2411 stamps, 22016 track features, 20718 graph nodes, 8 shinkansen
```

Verified: exits 0 on shipped data. It checks (first failure exits 1): unique
station codes + in-Japan coords (stations.json); count field == array length,
every non-null eki_code resolves, every entry has a code + valid coords, **no
literal HTML entities in the file** (stamp-stations.json); all features are
non-degenerate LineStrings with a 路線名 (geojson); declared counts, edge index
ranges, and no stale line names vs the geojson (rail-graph.json — catches a
forgotten `build_rail_graph.py` re-run); ≥2 in-bbox stops per line
(shinkansen.json). CI runs it in `.github/workflows/data-audit.yml`.

## The full regen pipeline (dependency order)

```sh
python3 scripts/scrape_funakiya.py        # NETWORK  line pages → funakiya-raw.json
python3 scripts/scrape_funakiya_jp.py     # NETWORK  station pages → funakiya-stations.json
python3 scripts/scrape_funakiya_lines.py  # NETWORK  line registry → funakiya-lines.json
python3 scripts/build_stamp_stations.py   # local    → stamp-stations.json  (wants pykakasi!)
python3 scripts/build_rail_graph.py       # local    → rail-graph.json
python3 scripts/build_shinkansen.py       # local    → shinkansen.json
```

All scripts are repo-root anchored — safe from any CWD (AUDIT 5.1: they used to
be CWD-relative and silently wrote `scripts/data/*.json`). Keep any new script
anchored the same way (`ROOT = dirname(dirname(abspath(__file__)))`).

- **Scrapers need network** (stamp.funakiya.com). In a sandboxed session they
  will fail or serve stale cache — see the traps below. The three `build_*`
  scripts are pure-local reads of `data/`.
- **`/tmp/funacache` trap:** scrapers cache every page there with **no TTL**.
  A stale cache silently freezes upstream changes; `rm -rf /tmp/funacache` to
  force a real scrape.
- **pykakasi trap:** `build_stamp_stations.py` imports it in a try/except —
  absence **silently degrades** every romanised fallback name (verified in this
  sandbox: without it the output loses hundreds of `name_en`/`line_names`
  values). `pip install pykakasi` before any real regen.
- **After refreshing `railroad-section.geojson` from upstream**, run
  `python3 scripts/disambiguate_geojson_lines.py` (in place, idempotent;
  optional argv[1] path to work on a copy). Why: bare homonym 路線名 (本線,
  日光線, 京都線…) merged unrelated railways until AUDIT Block 3 relabelled
  1,616 features to operator-qualified names; a raw upstream refresh reverts
  that. Saved rides under bare keys are auto-migrated by `js/rides.js`
  `RIDE_NAME_MIGRATION` — keep it in sync if the split set changes.

## Determinism status (verified in this sandbox, 2026-07)

| Script | Rerun vs shipped file |
|---|---|
| `build_rail_graph.py` | **byte-identical** — safe to run anytime |
| `build_shinkansen.py` | **byte-identical** — safe to run anytime |
| `build_stamp_stations.py` | **NOT reproducible from shipped inputs — do not ship a lone rerun.** Verified even with pykakasi: (a) 3 stamps disappear (tokyu-sangenjaya, jr-mitake, keio-takaosanguchi — shipped file was built from a fresher scrape than the shipped funakiya-raw.json); (b) 18 legacy bare-name `line_names` keys drop; (c) 15 records regress to literal `&#65374;` entities, because the shipped funakiya-raw.json predates the scrapers' `html.unescape` fix while the shipped stamp-stations.json was spot-repaired (AUDIT 4.3) — `check_data.py` will catch this one; (d) `line_names` key order churns run-to-run (set iteration). Correct flow: full re-scrape (network, fresh cache) → build → review the semantic diff, not just `git diff` |

So: `git diff` after `build_rail_graph.py`/`build_shinkansen.py` should be
empty; if it isn't, an input actually changed — investigate before committing.
If you ran `build_stamp_stations.py` experimentally,
`git checkout -- data/stamp-stations.json`.

**Scraper hygiene (MUST):** every extracted title/name goes through
`html.unescape()` (AUDIT 4.3: literal `&apos;`/`&#65374;` rendered verbatim in
the UI). The scrapers also feed `innerHTML` downstream — the app `esc()`s at
render time, but keep the data clean too.

## Ship discipline (data changes → release)

1. Land all pipeline fixes FIRST, then **one single regen pass** (AUDIT phase 4:
   the data should churn once per release, not per fix).
2. `python3 scripts/check_data.py` — green.
3. Run the ride-gap audit (see the **geometry-pipeline** skill for the verified
   sandbox recipe) — still **exactly the 15-gap baseline**, or deliberately
   update `MAX_GAPS` in `.github/workflows/data-audit.yml` with justification.
4. **Bump `APP_VERSION` in `js/config.js`.** Both IndexedDB caches key on it
   (`eki_stamp_stations_<v>` in `js/markers.js`, `eki_lines_<v>` in
   `js/lines.js`); without the bump clients keep stale data for up to 7 days
   (AUDIT 2.2 — the line cache was once unversioned and the README's promise
   was false).
5. Update README "Key data shapes" if any shape changed.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `check_data.py`: "literal HTML entities" | regen from stale funakiya-raw.json (pre-unescape scrape) | full re-scrape with fresh `/tmp/funacache`, then rebuild |
| `check_data.py`: "line names not in geojson (stale graph?)" | geojson changed (refresh/disambiguation) without re-running `build_rail_graph.py` | re-run it |
| Regen "changed nothing" yet upstream definitely changed | `/tmp/funacache` served every page | `rm -rf /tmp/funacache`, re-scrape |
| Hundreds of empty/kanji-only EN names after regen | pykakasi missing (silent) | `pip install pykakasi`, rebuild |
| stamp count ≠ 2411 / stamps vanished after regen | shipped file has curated deltas the shipped raw inputs lack (see determinism table) | re-scrape first; never ship a build from stale inputs |
| New ride gaps after a geojson refresh | homonyms re-merged (disambiguation reverted) | run `disambiguate_geojson_lines.py`, re-audit |
| Users still see old data after a ship | `APP_VERSION` not bumped | bump it; stale-version caches are pruned at startup |
| `data/*.json` appears under `scripts/` | a new script used CWD-relative paths | anchor to repo root like every existing script |

## Checklist before you're done

- [ ] `python3 scripts/check_data.py` green.
- [ ] `git status` shows NO unintended `data/` modifications (experimental
      reruns reverted).
- [ ] If geojson touched: disambiguation re-run + `build_rail_graph.py` re-run.
- [ ] If shipping data: single regen pass, `APP_VERSION` bumped, audit at
      baseline, README shapes current.
- [ ] Any new scraper code: `html.unescape` on extraction, repo-root anchored,
      caches under `/tmp/funacache` documented.
