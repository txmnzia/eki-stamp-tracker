# Overhaul plan — Eki Stamp Tracker (July 2026)

Phase 5 of the UX/UI audit (issue #21). Findings: `docs/AUDIT.md` (F-# / U-#
references below). System spec: `docs/DESIGN_SYSTEM.md`. **Plan only —
nothing here is implemented.**

Ground rules inherited from the repo: every phase ships through the
release checklist (unit tests, `check_data.py`, headless smoke, 15-gap
audit, `APP_VERSION` bump — `.claude/skills/release-checklist`); state/sync
code paths (`js/state.js`, `js/gist.js`, `js/session.js`) are
touch-with-care zones (2026-07 audit history); no build step, ever.

Effort: S ≤ half a day · M ≤ 2 days · L > 2 days, including verification.

---

## Phase A — Quick wins (no design system required)

Independent, individually shippable, ordered by value. Total: ~7 S items —
roughly two working days that remove the most-felt daily friction.

| # | Change | Fixes | Effort | Risk | "Done" looks like |
|---|---|---|---|---|---|
| A1 | **Rank search results**: prefix match > word-start > substring; tie-break by name length; keep 6 results. Pure reorder inside `renderSuggestions` (`js/search.js:21-24`). | F-1 | S | Low — pure function of existing inputs; add a unit test for the ranker (extract it pure, `tests/`) | typing `shin` lists Shinjuku/Shimbashi/Shinagawa before Hokkaido substring hits; test locks the order |
| A2 | **Style the token input**: give `#session-token-input` the `#session-name-input` recipe (share one rule). | F-2/U-1 | S | None | no white UA box; screenshot diff |
| A3 | **Own the bottom slot**: stats bar hidden while `#ride-edit-close` is visible; toast repositions above whichever occupant is present (CSS var for slot height); toast gets `max-width: calc(100vw-32px)` + wrapping, stats-bar hint dropped on `<480px`. | F-3/U-2, F-7 | S | Low — CSS + one class toggle in `ride-edit.js` | edit-mode: only Close at bottom-centre; toasts never overlap either; nothing clips at 390px |
| A4 | **Deep-link token creation**: replace the prose path with `github.com/settings/tokens/new?scopes=gist&description=eki-stamp-tracker` link; cut the paragraph to one hint line + link. | F-9, feeds F-4 | S | None | one click lands on a prefilled GitHub token page |
| A5 | **Truthful sync copy**: "Session loaded" → "Collecting as {name} on this device" when tokenless; `setSyncStatus('error')` gains a reason arg — 401/403 → "token invalid — replace it", network → "offline — will retry" (`js/session.js:95-101`, `js/notify.js:22`, callers in `js/gist.js` already have `err.status`). | F-10 | S | Low | each failure mode shows its own actionable message |
| A6 | **Fix `.loading-sub` contrast**: `var(--border)` → `var(--muted)`. | U-5 | S | None | ≥ 4.5:1 |
| A7 | **Delete `LINE_EDIT_DIM`** (`js/config.js:44`) and close issues #17/#18/#19 as shipped (verified in audit Phase 0). | inventory §1.5 | S | None | grep clean; issues closed with evidence links |

Dependencies: none between A-items. A3 is the only one touching layout used
by the ride-edit smoke test — re-run the interaction smoke afterwards.

## Phase B — Foundation: tokens + primitives, proven on the worst screen

**Scope:** implement DESIGN_SYSTEM.md §2 tokens and the six §3 primitives in
`css/app.css`; port **one** representative surface — the **session panel**,
chosen because it is the audit's worst screen (F-4, zero-hierarchy verdict
§3.3) and touches every primitive (buttons ×5 tones/states, inputs ×2,
card, field rows, sync status).

The session panel port includes its **content redesign**, not just reskin:

- Order: identity row → progress → one primary action for the current state
  (Load session / Save progress) → data ops (Export/Import) → sync setup
  behind a "Cloud sync" disclosure (token field + deep link from A4) →
  Reset alone at the bottom, quiet-danger tone.
- Copy diet per principle 5: case-sensitivity warning appears once, as one
  hint line; the 40-word token manual becomes the disclosure's hint + link.
- JS changes limited to class names and the disclosure toggle —
  no `state.js`/`gist.js` logic changes (touch-with-care rule).

| Aspect | Assessment |
|---|---|
| Effort | **M** (tokens+primitives ~1 day; panel port+redesign ~1 day) |
| Risk | Medium-low. Visual-only for the token layer (old class names alias to new primitives during migration, so unported screens keep working). Panel redesign alters DOM the session smoke test selects on — update `run-and-verify` selectors in the same PR. No geometry, no persistence logic. |
| Dependencies | A2/A4 fold into it (their rules become primitive instances). Ship after Phase A. |
| Done | tokens in `:root`, six primitives defined, session panel rebuilt on them; grep proves the panel contains zero off-token px/hex values; full §7 verification protocol green; before/after screenshots in the PR |

## Phase C — Systematic migration, by user impact

One PR per step; each deletes the legacy rules it obsoletes (the aliases
from B keep un-migrated screens intact between steps).

| Step | Surface(s) | Why this order | Effort | Risk |
|---|---|---|---|---|
| C1 | **Popups + line tooltip** (`buildPopupHtml` internals, `buildLinePopupHtml`, `.line-tip`) | most-seen surface in the daily loop | S | Low — engine untouched, classes/values only; `esc()` discipline unchanged |
| C2 | **Bottom chrome**: toast (+ `--error` variant, F-11), stats bar, Close pill on the A3 slot contract | second-most-seen; completes the F-3 story structurally | S | Low |
| C3 | **Topbar + suggestions** (search wrap, `.ui-btn`s, dropdown) + raise touch targets to ≥ 40px via size tokens (U-7) | daily but already decent; benefits from btn/input primitives maturing first | S | Low |
| C4 | **Welcome flow** — implements the Phase D1 deletion (below); the modal CSS is *removed*, not migrated | biggest single UX change; deliberately last so primitives and copy voice are settled | M | Medium — touches first-run logic in `welcome.js`; the mergeLocal-on-claim path (data-loss fix) must be preserved exactly; needs the state-and-sync skill read first |
| C5 | **JS color unification**: markers/lines/ride styles read token values via one `uiColors` map sourced from `getComputedStyle` at init (`js/markers.js:69-79`, `js/lines.js:50,115`, `js/ride-edit.js:98`, `js/rides.js:92`) | closes U-4; enables any future theming | S | Low-medium — repaint-path only; verify marker colors in smoke + eyeball zoomed-out view |
| C6 | **Mobile marker noise** (F-6): plain markers on touch drop tap-priority sizing; appear from zoom ≥ 11 (threshold tunable in `config.js`) | needs C5's color map; changes map *feel*, so isolated and last | S | Medium — perception change; validate on-device, keep the tunable so it's a one-line revert |

Cross-cutting "done" for Phase C: `css/app.css` contains only tokens,
primitives, Leaflet overrides, and layout; the audit's counts collapse to
the spec (≤ 8 named colors + 3 alphas, 5 font sizes, 5 spacing steps,
3 radii, 2 shadows, 2 durations); full verification protocol green after
every step; `APP_VERSION` bumped per merge.

## Phase D — Deletions

The brief expected dead weight; the honest finding is that this app's excess
is **flow and copy, not code** (AUDIT.md §1.5). The list is still non-empty:

| # | Delete | Replacement behaviour | Effort | Risk |
|---|---|---|---|---|
| D1 | **The welcome modal, entirely** (F-5): `#name-modal-overlay` + `setupModal` + focus-trap code (~90 lines HTML/CSS/JS) | First run lands directly on the map with the existing "tap any station to begin" hint. Naming/sync moves to where it's real: the session panel (post-B redesign), plus a one-time quiet toast after the first stamp — "Saved on this device — add a name in Session to sync" — deep-linking the panel. The mergeLocal-on-first-name path is kept verbatim. | M (part of C4) | Medium: first-run persistence paths; guarded by state-and-sync rules + smoke tests |
| D2 | **Station hover-popup machinery** (F-12): grace timer, popup mouseenter/leave handlers, `POPUP_GRACE_MS` (~40 lines, `js/markers.js:193-232`) | Stations adopt the line grammar: hover = name tooltip, click/tap = action popup. One hover behaviour app-wide; popup churn in dense areas ends. | S–M | Medium: changes desktop collect from 1 click to 2 (hover-popup collect was the 1-click path). **Decision gate: open question 2 in AUDIT.md — needs owner sign-off, not a silent change.** If 1-click collect wins, keep hover-popups and close the question; consistency can also be achieved by making *lines* hover-open (rejected by default: more churn, not less). |
| D3 | **Duplicate + manual copy** (F-4): second case-sensitivity warning, permanent token how-to, `#stats-hint` after first stamp (exists), the toast instruction overlap in edit mode (superseded by A3 slot rules) | One warning, one hint line, one disclosure | S (inside B/C4) | None |
| D4 | **Dead constant** `LINE_EDIT_DIM` | — (A7) | S | None |
| D5 | **`--stamp-off`, `#d4a830`, `#3a2222`, `#888`** and the 17 ad-hoc alphas | token equivalents (B) | S (inside B) | None |

Explicitly considered and **kept**: language toggle (small, used, correct);
export/import (the only escape hatch for a localStorage-first app); the
non-stamp station layer itself (identifying "what station is this?" is core
map utility — it gets *quieter* in C6, not deleted); the two-step confirm
pattern; triple-tap zoom-out (touch-tested convention).

## Sequence & gates

```
A1–A7 (parallel, ship immediately)
   └─► B  tokens + primitives + session panel (proof)
          └─► C1 popups ─► C2 bottom chrome ─► C3 topbar
                                └─► C4 welcome deletion (D1, D3)
          └─► C5 JS colors ─► C6 mobile markers
D2 ships whenever its decision gate clears (independent of C order)
```

- Every step: full `run-and-verify` §7 protocol; geometry-touching steps
  (there are none planned — that's deliberate) would additionally need the
  ride-gap audit, which runs in CI regardless.
- `APP_VERSION` bump on every merge (CLAUDE.md rule 6).
- After C6, re-run this audit's Phase 1 counts (the commands are one-liners
  against `app.css`) and append the before/after table to AUDIT.md — the
  numeric collapse *is* the acceptance test for the overhaul.

## What this plan refuses to do

- No React/bundler migration (DESIGN_SYSTEM.md §1 — gate not met).
- No geometry or data-pipeline changes; open question 1 (Keio New Line
  name pairing) is routed to the data pipeline as a separate issue, not
  smuggled into UI work.
- No feature additions. The overhaul earns minimalism by subtraction and
  regularity; new capabilities (achievements, sharing, offline tiles…)
  are out of scope until the system exists for them to land on.

---

## Addendum — implementation record (July 2026, this branch)

Phases A–D were implemented on `claude/ux-audit-refactoring-p38bb4`, with two
owner decisions taken during implementation:

1. **The collect control was redesigned beyond C1's repaint** (owner request:
   "lightweight, seamless, almost text-free"). The station popup became a
   *stamp card*: name + line-color dots + one big round **stamp seal**
   (`.popup-collect-btn`, class kept as the tooling contract). Toggling works
   three ways — tap the seal, tap the station dot again while its card is
   open, or (desktop) hover-then-single-click the dot. A literal
   double-click-to-collect was considered and rejected: it collides with
   desktop double-click zoom and the app's custom touch double-tap zoom.
   Instead the tap-tap rhythm is kept but the gestures are de-conflicted:
   popup taps never count toward zoom gestures, station-tap sequences
   suppress the double-tap zoom (`ui.lastStationTap`), and a
   `STAMP_TOGGLE_GUARD_MS` window stops a double-click from
   collect-then-remove.
2. **D2 is resolved: hover-open stays.** With the card now lightweight and
   hover+click forming the 1-click desktop collect, removing hover-open would
   have destroyed the flow it was meant to clean up. The grace-timer
   machinery is retained.

Deviations from the letter of the plan: C4's "quiet toast after first stamp"
uses a one-time localStorage flag (`eki_first_stamp_hint`); C6 hides plain
markers below `PLAIN_MIN_ZOOM` on touch *and* drops them to desktop sizing;
the session panel's cloud-sync fold uses a native `<details>` element (no JS).

### Iteration 3 (owner feedback on the v1.6 stamp card)

The v1.6 seal-card was rejected in review: popups were oversized, stamp
popups lost the line names, and stamp/non-stamp behaviour diverged. Shipped
replacement (v1.7.0), per owner spec with two challenged amendments:

- **The dot IS the stamp**: stamp stations render as DOM markers with a
  hand-stamp glyph (`ICON_STAMP_MARKER`), grey when uncollected, **ink red**
  (`--ink`, replacing `--gold` app-wide) when stamped. Glyphs scale via one
  `--stamp-scale` property per zoom; plain stations remain canvas dots.
- **Double click / double tap toggles** (owner spec, kept): implemented as
  our own click-pair window (`STAMP_DBL_MS`) so desktop and touch behave
  identically; desktop `doubleClickZoom` reimplemented with stamp markers
  carved out; touch tap sequences on stamps never zoom.
- **Amendment 1 — hover is a tooltip, click is one consistent popup**: every
  station (stamp or not) shows the same compact name+line-badges popup on
  single click, restoring line names and killing the inconsistency.
- **Amendment 2 — a discreet Stamped/Not stamped row** stays in the popup as
  the keyboard-accessible and colorblind-safe toggle (`.popup-collect-btn`
  class kept as the tooling contract).
- Leaflet's built-in marker click→popup toggle is removed (same as lines.js)
  — it raced the click-pair logic and flashed popups during double clicks.
