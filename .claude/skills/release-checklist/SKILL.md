---
name: release-checklist
description: End-to-end checklist for shipping an Eki Stamp Tracker change to main — which validation each change type needs, APP_VERSION bump discipline, data-regeneration ordering, README/doc updates, and what CI runs and how to react when it fails. Use when preparing a PR/merge to main, bumping APP_VERSION, shipping regenerated data/ files, or diagnosing a data-audit workflow failure.
---

# Release checklist — shipping to main

Work through the sections in order. Steps that don't apply to your change type
say so.

## 1. Validate by change type

| Change touches | Required validation |
|---|---|
| `js/` only | `node --test tests/*.test.mjs` (18 tests, all pass) + drive the affected flow in the real app — use the `run-and-verify` skill. If geometry/ride code changed: also the ride-gap audit (`ride-gap-audit` skill) — the baseline must stay exactly at the accepted count |
| `data/` (any regenerated file) | `python3 scripts/check_data.py` (prints `all data checks passed: …`) + ride-gap audit + spot-check names/colours in the running app |
| `css/app.css` / `index.html` markup | Visual pass via the `run-and-verify` skill (desktop + narrow/touch viewport); confirm keyboard flows (search, session panel, modal) still work |
| `js/state.js`, `js/gist.js`, `js/session.js` | ALL of the above that apply **plus** the manual sync test sequence in the `state-and-sync` skill |
| `scripts/*.py` pipeline | Do not ship a pipeline fix alone — see §3 |

Commands verified in this repo (run from the repo root):

```sh
node --test tests/*.test.mjs     # pass 18 / fail 0 — same invocation CI uses
python3 scripts/check_data.py    # "all data checks passed: 10452 stations, 2411 stamps, …"
```

Note: bare `node --test tests/` fails on Node 22 ("Cannot find module …/tests");
use the glob form above (or plain `node --test`).

## 2. APP_VERSION bump (every merge to main)

- Bump `APP_VERSION` in `js/config.js` on **every merge to main**, not just data
  ships — it is the in-code convention (see the constant's comment and
  `docs/REFACTOR-2026-07.md` §6).
- Why it matters: `APP_VERSION` keys **BOTH** IndexedDB caches —
  `eki_stamp_stations_<APP_VERSION>` (`js/markers.js`) and
  `eki_lines_<APP_VERSION>` (`js/lines.js`). Stale versions are pruned at boot
  (`cachePrune` in `js/idb-cache.js`). Forgetting the bump means users keep
  cached data for up to `CACHE_TTL` (7 days) — the line cache once shipped
  unversioned and silently served stale track geometry after data ships
  (AUDIT 2.2).

## 3. Data ships (skip if `data/` is untouched)

- **All pipeline fixes land BEFORE the single regeneration pass.** The audit's
  phase-4 lesson: batch every scraper/builder fix, then regenerate once, so the
  data churns once and the diff is reviewable. Pipeline order and prerequisites
  (`pykakasi`, the `/tmp/funacache` no-TTL cache, the disambiguation re-run) are
  in README "Regenerating data" — follow it verbatim.
- Run `python3 scripts/check_data.py` and the ride-gap audit against the fresh
  data locally before pushing (the `ride-gap-audit` skill has the sandbox-safe
  recipe).
- If the audit's gap count changes **and every new/removed gap is a verified
  genuine data hole**, update `MAX_GAPS` in `.github/workflows/data-audit.yml`
  and list each gap with its justification in the PR description. Never bump
  `MAX_GAPS` to make CI green without classifying the gaps — the baseline exists
  so only regressions fail the build. Also update the README's residual-gap list
  (the "Ride gaps" section) in the same PR.
- Bump `APP_VERSION` (§2) — mandatory for any data ship.

## 4. README & docs discipline

- **The README is the operative manual.** Update it in the SAME PR that changes
  behaviour, or it silently rots. Check whether your change affects:
  - the **code map table** (new/renamed module or moved responsibility);
  - the **data shapes** section (any `data/` schema change);
  - the **gap baseline list** (any `MAX_GAPS` change, §3);
  - conventions / sync / regeneration instructions.
- `docs/` holds design-of-record documents (`REFACTOR-2026-07.md`,
  `AUDIT-2026-07.md`, `HANDOVER-line-highlight.md`). Add a new doc there for a
  new design decision; don't retro-edit history in the audit/refactor docs.

## 5. CI (`.github/workflows/data-audit.yml`)

Triggers on PRs touching `data/**`, `index.html`, `js/**`, `css/**`, `tests/**`,
or `scripts/**` (and manual `workflow_dispatch`). Three jobs:

| Job | Runs | When it fails |
|---|---|---|
| `unit-tests` | `node --test tests/*.test.mjs` | A pure-geometry regression in `js/geometry.js` (or a test file syntax error). Reproduce locally with the same command; geometry changes must be mechanical (see `conventions` skill) |
| `ride-gaps` | installs Playwright Chromium, serves the repo (`python3 -m http.server 8097 &`), runs `scripts/audit-ride-gaps.mjs` with `MAX_GAPS: '15'` | New gap(s) above baseline ⇒ your change broke stitching/corridor/routing or the data lost track. Run the `ride-gap-audit` skill locally, diff its per-line report against the README's known-gap list, and fix the code/data — only touch `MAX_GAPS` per §3 |
| `data-sanity` | `python3 scripts/check_data.py` | Structural corruption in shipped data (bad feature, duplicate code, dangling reference). Re-run locally; fix the pipeline script, then regenerate (§3) — never hand-edit generated JSON |

A `ride-gaps` failure with count **below** 15 plus new gaps elsewhere still means
a regression: the number can stay ≤ baseline while gaps *moved*. Always read the
audit's per-line output, not just the total.

## 6. Final gate before merge

- [ ] Validation for your change type (§1) all green locally.
- [ ] `APP_VERSION` bumped in `js/config.js`.
- [ ] Data: single regen after all pipeline fixes; `MAX_GAPS` untouched or justified per-gap in the PR (§3).
- [ ] README updated in the same PR (code map / data shapes / gap list / conventions as applicable).
- [ ] No secrets, no `node_modules`, no `package.json`, no scratch files in the diff (`git status` clean of artefacts).
- [ ] New code follows the `conventions` skill; sync-area changes passed the `state-and-sync` manual sequence.
- [ ] CI green on the PR; merge, then confirm the deployed app loads with the new version string (welcome modal / session panel footer).
