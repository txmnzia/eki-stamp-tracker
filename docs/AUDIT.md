# UX/UI Audit — Eki Stamp Tracker (July 2026)

Phases 1–3 of the UX/UI audit requested in issue #21. Companion documents:
`docs/DESIGN_SYSTEM.md` (Phase 4) and `docs/OVERHAUL_PLAN.md` (Phase 5).
**Audit only — nothing in this document has been implemented.**

## Phase 0 — Visual access (method & caveats)

The audit was performed against the **running app**, not just the code:
served with `python3 -m http.server`, driven headlessly with Playwright
(Chromium, 1280×900 desktop and 390×844 touch/mobile contexts), following
`.claude/skills/run-and-verify`. Seventeen distinct UI states were captured;
the seven cited most often are committed under `docs/img/ux-audit/`.
Zero console errors were observed across every state exercised.

Two sandbox caveats, so evidence is weighed honestly:

1. **Map tiles were stubbed** (the sandbox proxy blocks `basemaps.cartocdn.com`),
   so screenshots show a light Leaflet fallback background instead of the
   production dark CARTO tiles. Every judgement about *tile* contrast was
   therefore made from code (`js/map-setup.js:49`, dark_all tiles + the dark
   token palette), not pixels. All app chrome — panels, popups, buttons,
   toasts — renders true.
2. **Web fonts were stubbed** for determinism; metrics judgements use the
   fallback monospace, which is close to Space Mono.

Everything else — flows, click counts, collisions, persistence — was verified
live (e.g. painting a Yamanote ride and confirming
`eki_local_progress.rides = {"JR山手線": [...]}` in localStorage).

## An honest framing before the findings

The brief assumed "UX layered on UX with no unifying vision … inconsistent UI,
duplicated patterns, dead weight." **The measured reality is better than the
brief assumes.** This codebase was split and remediated a month ago
(`docs/REFACTOR-2026-07.md`, v1.4.0/v1.5.0), a token block already exists at
the top of `css/app.css`, there is **zero dead CSS** (every non-Leaflet
selector in `app.css` is referenced from markup or JS — verified by
cross-referencing all 92 selectors), and exactly **one dead JS constant**
(`LINE_EDIT_DIM`, `js/config.js:44`). Open issues #17/#18/#19 are already
implemented on `main` (commits 27e7995, c5195a8, 3103443; verified live —
the read-only edit-mode station popup renders, global edit works, the single
Close pill saves and exits). They should be closed, not re-fixed.

The debt that *does* exist is real but localized: one visually broken input,
one colliding bottom-center layer stack, an unranked search, a session panel
that reads like documentation, and component styles rebuilt per surface
instead of shared. That is a tightening job, not a rebuild — and the numbers
below are the evidence either way.

---

## Phase 1 — Inventory (facts only)

### 1.1 Navigation map

The app is a **single screen** (the map) with overlays. There is no routing,
no page navigation. Complete state inventory:

| # | Screen / state | How reached |
|---|---|---|
| 1 | Loading overlay | app start, until stations render (`#loading-overlay`) |
| 2 | Welcome modal | every load while anonymous (`js/welcome.js:35`) |
| 3 | Map, default view (Tokyo z13) | dismiss/complete modal |
| 4 | Search suggestions dropdown | type in `#stationSearch` |
| 5 | Station popup — stamp, uncollected | hover (desktop) or tap a stamp dot |
| 6 | Station popup — stamp, collected | same, when collected |
| 7 | Station popup — non-stamp (`nostamp`) | hover/tap a faint plain dot |
| 8 | Station popup — read-only | hover a station during ride edit |
| 9 | Line hover highlight + name tooltip | mouse over a line |
| 10 | Line popup ("Add a ride" / "Edit ride") | click a line |
| 11 | Ride edit mode | line popup → ride button |
| 12 | Ride edit, segments painted | pointer-drag along active line |
| 13 | Session panel — anonymous | `#session-toggle` |
| 14 | Session panel — session active | after Load session |
| 15 | Reset/Import confirm-pending | first click on Reset / Import-with-data |
| 16 | Toast | after most actions (`js/notify.js`) |
| 17 | Stats bar | always visible, bottom centre |

Fifteen of these seventeen states were screenshot-verified; states 5–8 are
four *variants of one popup* built in one function (`buildPopupHtml`,
`js/markers.js:89`) — a good existing consolidation.

### 1.2 User flows and click counts

Interactions counted from the state the user is already looking at the map.
"Click" = click/tap; typing counted separately.

| Flow | Steps today | Count | Plausible minimum | Verdict |
|---|---|---|---|---|
| First-run to map (new user) | modal appears → "Skip for now" | 1 click before *anything* | 0 | modal is a toll gate (F-5) |
| Collect a stamp, desktop power user | hover dot → click Collect | **1 click** | 1 | excellent |
| Collect a stamp, mobile | tap dot → tap Collect | 2 taps | 2 | good |
| Collect via search | type → click suggestion → click Collect | 2 clicks + typing | 2 | good *if* search ranks well — it doesn't (F-1) |
| Un-collect (fix a mistake) | click "Collected" | 1 click | 1 | good; no confirm, toast confirms (fine — reversible) |
| Log a ride | click line → "Add a ride" → drag paint → "Close editing" | 3 clicks + 1 gesture | 3 + gesture | good (post-#19 rework) |
| Extend a ride later | same, button reads "Edit ride" | 3 clicks + gesture | 3 | consistent ✓ |
| Toggle language | 1 click | 1 | 1 | good |
| Export progress | Session → Export JSON | 2 clicks | 2 | good |
| Reset everything | Session → Reset → confirm click | 3 clicks | 3 | *correctly* frictioned |
| Enable cloud sync (once) | Session → type name → Load → **leave app, create GitHub token (~10 clicks on github.com)** → paste | 3 clicks + external trip | — | the external trip is inherent to the no-backend design, but the app gives prose directions instead of a deep link (F-9) |

### 1.3 Interactive component patterns and variant counts

This is the duplication evidence. Every family below expresses the *same
intent* (dark surface, 1px border, Space Mono uppercase label) with different
hand-rolled values:

**Buttons — 7 visually distinct treatments, 13 counting state classes:**

| Variant | Where | font-size | padding | radius | casing |
|---|---|---|---|---|---|
| `.ui-btn` | topbar | 11px | 8×14 | 6px | uppercase |
| `.session-btn` (+`.primary`, `.danger`, `.confirm-pending`) | session panel | 10px | 7×10 | 4px | uppercase |
| `.modal-btn` (+`.secondary`, `.confirm`) | welcome modal | 11px | 10 | 4px | uppercase |
| `.popup-collect-btn` (+`.collected`) | station popup | 11px | 9×12 | 6px | uppercase |
| `.popup-line-ride-btn` (+`.has-rides`) | line popup | 11px | 9×12 | 4px | none |
| `#ride-edit-close` | edit mode | 11px | 10×18 | 999px | uppercase |
| Leaflet zoom (restyled) | bottom-left | — | — | — | — |

**Text inputs — 4 treatments, 1 broken:**

| Input | Styling |
|---|---|
| `#stationSearch` | borderless inside `#search-wrap` |
| `#modal-name-input` | 16px JP font, own rule block |
| `#session-name-input` | 12px mono, own rule block |
| `#session-token-input` | **none — browser default white UA styles** (F-2) |

**Elevated surfaces — 8 instances, 4 shadow recipes, 4 radii:**
search wrap (r6, shadow `0 4px 16px`), suggestions (r6, `0 8px 24px`),
session panel (r6, `0 8px 24px`), welcome modal (**r10**, `0 20px 60px`),
popup (r6, `0 8px 24px` + `!important`), line tooltip (r6, `0 4px 16px`),
toast (r6, `0 4px 16px`), stats bar (**r20**, `0 2px 12px`).

**Feedback patterns — 3 coexisting:** toast (`#toast`), sync status line
(`.sync-status`, 4 states), and in-button state swap (`confirm-pending`,
"Collected"). The toast is the only channel for errors and success alike,
same style for both (F-11).

### 1.4 Raw CSS facts (computed from `css/app.css`, comments stripped)

- **Colors:** 45 uses, **30 distinct values** — but only **4 hues + neutrals**:
  blue `#7eb8f7`, gold `#f7c948`, red `#f77e7e`, green `#6fdd8b`, and 8
  greys. 17 of the 30 are one-off `rgba()` alpha variants of those hues
  (e.g. gold at 0.06/0.08/0.15/0.2/0.3/0.35; blue at 0.12/0.2/0.22/0.28/0.35).
  **5 more UI colors live only in JS** (`js/markers.js:69-79` marker gold/grey
  `#9aa0ac`, `js/lines.js:50,115` fallbacks `#6b6b7a`/`#888`,
  `js/ride-edit.js:98` fallback blue) — the marker grey, one of the most
  visible colors in the app, appears nowhere in the stylesheet.
- **Font sizes:** **10 distinct** (9.5, 10, 11, 12, 13, 14, 16, 17, 18, 20px);
  41 uses. 9.5px (`.popup-line-en`) and 10px (7 rules) are below common
  legibility floors.
- **Font families:** 2 (Space Mono for UI, Zen Kaku Gothic New for JP) — clean.
- **Spacing:** **24 distinct padding values**, 7 gap values (1–16px) — no scale.
- **Radii:** **9 distinct** (2, 3, 4, 6=`--radius`, 10, 20, 999px, 50%) —
  `--radius` exists and is bypassed five ways.
- **Shadows:** 6 distinct recipes across 9 uses.
- **Letter-spacing:** 7 distinct values (0.03–0.12em).
- **Transitions:** 9 distinct across 15 uses (0.1s/0.15s/0.2s/0.25s/0.3s/0.4s).
- **`!important`:** 25 uses — all Leaflet overrides, which is the standard
  (if ugly) way to reskin Leaflet chrome; acceptable.
- **Existing tokens:** 12 custom properties + a z-index scale already in
  `:root` (`css/app.css:4-23`). The foundation is there; type/spacing/state
  alphas simply never joined it.

### 1.5 Dead code

- `LINE_EDIT_DIM` (`js/config.js:44`) — exported, never imported or used;
  leftover from the pre-#18 per-line edit mode.
- **No unreachable CSS** (all 92 non-Leaflet selectors referenced).
- **No unreachable flows.** The closest thing to dead weight is *duplicated
  copy*, not code: the case-sensitivity warning ships twice
  (`index.html:71` and `index.html:109`), and the token how-to paragraph
  (`index.html:78-80`) is a 40-word manual living permanently in the panel.

---

## Phase 2 — UX audit (findings, severity-rated)

Journeys walked: first-time visitor; daily desktop collector; mobile
collector on a platform (one-handed); ride logger after a trip; multi-device
user setting up sync. Ratings: **Blocker / Major / Minor**.

**No Blockers were found.** Nothing prevents task completion; the app's core
loop (see dot → collect → see progress) is genuinely fast (1 click on
desktop). The Majors below are daily-frequency friction or trust damage.

### F-1 · Major — Search is unranked; the most likely target loses to data order
`js/search.js:21-24` filters by substring and takes the first
`MAX_SUGGESTIONS=6` **in station-array order, which is roughly
north→south**. Typing `shin` returns Shin-Hakodate-Hokuto, Shinrin-koen,
Shintoku, Shin-Sapporo, Shin-Yubari, Shinkawa — six Hokkaido stations — and
never Shinjuku or Shimbashi (evidence:
`docs/img/ux-audit/04-search-suggestions.png`). A daily flow degrades into
"type the full name or scroll the map". Prefix matches and
already-collected/nearby stations should outrank substring hits from 800km
away. This is the single highest-value small fix in the app.

### F-2 · Major — The GitHub token input is completely unstyled
`#session-token-input` has no CSS rule; it renders as a white,
serif-placeholder UA-default box inside the dark panel (evidence:
`docs/img/ux-audit/07-session-panel-anonymous.png`,
`22-mobile-session-panel.png`; compare `#session-name-input`,
`css/app.css:212`). Cosmetic in mechanism, not in effect: this is the field
where the app asks for a **credential** — the one moment where looking
broken costs trust.

### F-3 · Major — Bottom-centre is a collision zone: stats bar, toast, and Close button stack on the same pixels
Three fixed elements share bottom-centre: `#stats-bar` (bottom 24px),
`#toast` (bottom 24px), `#ride-edit-close` (bottom 20px). Observed live:
the "stamped!" toast half-covers the stats bar
(`07-session-panel-anonymous.png`, bottom edge); entering edit mode, the
3.5s instruction toast **covers the Close button** the user was just told to
use (`13-ride-edit-mode-toast.png`); once the toast fades, Close sits
*on top of* the stats bar, both partially legible
(`14-ride-edit-painted.png`: "0 / 2,391 stamps ✓ CLOSE EDITING ation to
begin"). Every save confirmation replays some version of this. The layers
need one owner: a single bottom slot with stacking rules (and the stats bar
should yield during edit mode).

### F-4 · Major — The session panel reads like documentation, not a control
One panel holds: avatar row, sync-status line, progress row, two labelled
inputs, a 40-word token manual, two warning paragraphs, five buttons
including an always-visible destructive one, and a version string
(`index.html:44-100`, `07-session-panel-anonymous.png`). Nielsen
"aesthetic & minimalist design" and the project's own "Apple-like restraint"
brief both fail here. The case-sensitivity warning also appears in the
welcome modal — the same caution shipped twice
(`index.html:71`, `index.html:109`). The token manual belongs behind a
"How sync works" disclosure (or a link), not permanently on screen; Reset
belongs behind the fold or in an overflow, not adjacent to Import.

### F-5 · Major — The welcome modal charges an up-front toll for a concept the user can't evaluate yet
Every anonymous load opens a modal asking for a "sync name" — a term that
only means something *after* using the app — before showing the product
(`js/welcome.js:35-38`, `02-welcome-modal.png`). The primary-styled button
("Start collecting") is actually the *naming* commitment; the honest primary
for a first-timer is "show me the map", which is styled as the escape hatch
("Skip for now"). And because skipping doesn't persist a choice, the modal
returns on **every** load until the user names themselves — repeat friction
aimed at exactly the users who declined. The map itself, with its
"tap any station to begin" hint, is a better welcome than the modal.

### F-6 · Major — Mobile map is dominated by non-stamp noise
On touch, every marker doubles in base radius for tappability
(`MARKER_BASE_R_TOUCH=8`, `js/config.js:24`) — including the ~6,700
*non-stamp* dots, which at default zoom become a field of large grey blobs
that visually bury the 2,391 stamp targets and the network itself
(`21-mobile-map.png`). Legibility of the *point of the app* (find stamp
stations) is inverted: the least important layer is the heaviest. Plain
markers don't need tap-priority sizing; they need to recede (smaller radius
and/or zoom-gated appearance on touch).

### F-7 · Minor — Stats bar truncates on small screens
`#stats-bar` is `white-space: nowrap` with the italic hint appended; at
390px the string clips mid-word at the screen edge: "…tap any station to b"
(`21-mobile-map.png`, `css/app.css:295-307`). The toast shares the same
nowrap-without-max-width pattern (`css/app.css:290`), so long toasts (the
41-character edit-mode instruction, session names in "Session loaded: …")
will also clip on narrow screens.

### F-8 · Minor — Reset has no recovery path
The two-step confirm (`js/session.js:180-204`) is good friction, but after
the second tap all stamps and rides are cleared locally *and* synced upward;
the only recovery is a manual prior Export. A "Progress reset — Undo" toast
holding the pre-reset snapshot for ~10s would make the app's one truly
destructive action survivable. (Import-overwrite has the same shape but
already warns "Replace current data?" — consistent, same undo would fit.)

### F-9 · Minor — Sync setup gives directions instead of a door
The token instructions are prose: "github.com → Settings → Developer
settings → Tokens" (`index.html:79`). GitHub supports a prefilled deep link
(`https://github.com/settings/tokens/new?scopes=gist&description=eki-stamp-tracker`)
that would collapse ~6 of the external clicks and prevent scope mistakes the
app itself warns about. One `<a>` replaces a paragraph.

### F-10 · Minor — "Session loaded" over-promises in local-only mode
Without a token, Load session still toasts "Loading {name}…" then
"Session loaded: {name}" (`js/session.js:95-101`) — but nothing was loaded;
a local name was set. Meanwhile the status line separately says "saved on
this device". Copy should tell the truth per mode ("Collecting as {name} on
this device"). Similarly "✗ sync error · retry" (`js/notify.js:22`) is one
message for *every* failure — expired token (actionable: replace token) vs
offline (actionable: wait) — though the app knows `err.status`
(`js/gist.js:109-111,153-155`).

### F-11 · Minor — Success and failure wear the same clothes
All toasts share one neutral style (`css/app.css:282-292`); "Import failed —
not a valid Eki JSON file" renders identically to "— stamped!". Errors
deserve a variant (border/icon), not a different channel.

### F-12 · Minor — Desktop hover opens the full action popup, not a preview
Hovering any station opens the complete popup with its Collect button, held
open by a 600ms grace timer and hand-tuned enter/leave handlers
(`js/markers.js:193-232`). Panning across dense Tokyo fires popups
continuously. Lines already do this right: hover = lightweight name tooltip,
click = action popup (`js/lines.js:70-77`). Stations should match —
one consistent hover grammar, and ~40 lines of grace-timer code retire.
(Code comments show the hover-popup is deliberate, so listed as a finding
*with* an open question below.)

### Heuristics checklist (Nielsen, remainder)

- **Visibility of status:** strong — loading overlay, per-action toasts,
  live sync status, progress bar, stamp count. ✓
- **Match with real world:** strong — "Collect stamp", "Add a ride",
  "Save progress"; bilingual naming done carefully. ✓ (exception: "sync
  name"/"session" jargon in the modal, F-5.)
- **User control & freedom:** collect/paint reversible ✓; Esc exits edit
  mode ✓; reset unrecoverable (F-8).
- **Consistency:** ride button correctly renames Add→Edit across states ✓;
  hover grammar inconsistent between stations and lines (F-12); seven
  button dialects (Phase 1.3).
- **Error prevention:** two-step confirms on both destructive actions ✓;
  token scope warning ✓.
- **Recognition over recall:** the case-sensitive sync name is pure recall —
  mistype it on a second device and you silently get an empty collection
  (mitigated by warnings, which is why there are three of them; the design
  choice creates the copy bloat of F-4).
- **Flexibility & efficiency:** 1-click desktop collect ✓; keyboard path
  exists via search (arrows + Enter + focusable popup button) ✓; no
  keyboard path to arbitrary map markers (canvas dots are not focusable) —
  accepted Leaflet-canvas limitation, noted for the record.
- **Help & documentation:** inverted — the manual is *in* the primary UI
  (F-4) while genuinely helpful docs (what is an eki stamp?) don't exist.

### Open questions (bug vs. design choice — not guessed at)

1. **Line-name pairing:** the station popup for 新線新宿 shows English
   "Toei Subway Oedo Line" over kanji 京王新線 (Keio New Line) — observed
   live at Shinjuku. Wrong `lineEnMap` join upstream, or an ekidata quirk?
   Needs a data-pipeline check (`.claude/skills/data-pipeline`), not a UI fix.
2. **Hover-opens-popup on stations** (F-12) is commented as deliberate —
   is the product intent "fastest possible collect" (keep) or "calm map"
   (change to tooltip)? Recommendation: change; decision is the owner's.
3. **Language toggle scope** is names-only by design (`js/lang.js:30-31`).
   Is a fully bilingual UI wanted eventually? Affects whether copy fixes
   (F-4/F-10) should land in an i18n-ready shape.
4. **Non-stamp markers on mobile** (F-6): reduce size, or gate behind a zoom
   threshold? Both work; the second also helps desktop density.

---

## Phase 3 — UI audit

### 3.1 The inconsistency, numerically

> 7 button treatments · 4 input treatments (1 unstyled) · 8 surface recipes
> with 4 shadows and 4 radii · 30 CSS colors (+5 in JS) for a 4-hue palette ·
> 10 font sizes · 24 padding values · 9 radii · 7 letter-spacings ·
> 9 transitions

The important nuance: these are **parallel dialects of one visual idea**,
not competing visual ideas. Every button family is trying to be the same
button. That makes consolidation cheap (map variants onto one primitive)
and low-risk (no screen will change *character*, only regularity).

### 3.2 What to keep as the seed of the design system

Worth keeping — these already behave like a system:

- The **token block + z-index scale** (`css/app.css:4-23`) — extend it, don't
  replace it.
- The **dark cartographic aesthetic**: near-black surfaces, one blue accent,
  gold = collected. Distinctive and disciplined; gold-on-dark reads at
  10.08:1.
- **`buildPopupHtml` as one popup engine** with modifier classes
  (`nostamp`, `readonly`) — the model every other component should follow.
- The **two-font rule** (Space Mono UI / Zen Kaku JP) and uppercase-mono
  label voice. Quirky, consistent, owned. (Body-length text in Space Mono is
  the one strain — see 3.4.)
- **Two-step in-button confirm** (`confirm-pending`) — better than a
  `confirm()` dialog and already used for both destructive actions.
- The **edit-mode grammar**: dim the world, brighten the subject, one exit
  that saves (`#ride-edit-close`, `css/app.css:349-365`).

Should die:

- Per-surface hand-rolled buttons/inputs/cards (Phase 1.3) → one primitive
  each.
- The 17 ad-hoc alpha variants → 2–3 named state alphas.
- The welcome modal as a whole (F-5).
- The permanent token manual + duplicate warnings (F-4).
- 9.5px/10px text tiers (3.4).
- The station hover-popup grace machinery (F-12).

### 3.3 Visual hierarchy per screen (is the primary action obvious in 1s?)

| Screen | Primary action | Obvious? |
|---|---|---|
| Map (fresh) | tap a station | **Yes** — hint says exactly that; gold-vs-grey encoding reads instantly once one stamp exists. On mobile, degraded by grey-blob noise (F-6). |
| Welcome modal | see the app | **Inverted** — accent styling promotes the naming commitment; the newcomer's real goal is styled as the escape (F-5). |
| Station popup | Collect stamp | **Yes** — single full-width button. |
| Line popup | Add/Edit ride | **Yes.** |
| Edit mode | paint, then Close | **Yes conceptually**, but the instruction toast covers the exit for 3.5s and Close overlaps the stats bar (F-3). |
| Session panel | depends on state | **No** — Load session is primary-styled but drowned by two inputs, three paragraphs and five buttons; Reset (red) competes for attention it shouldn't have (F-4). |

### 3.4 Accessibility basics

Measured contrast (WCAG ratio, dark theme):

| Pair | Ratio | Verdict |
|---|---|---|
| `--text` on `--bg` | 15.13:1 | AAA |
| `--muted` on `--surface` | 6.27:1 | AA ✓ |
| `--muted` on `--surface2` | 5.60:1 | AA ✓ |
| `--accent` on `--surface` | 8.49:1 | AAA |
| gold on `--surface2` | 10.08:1 | AAA |
| danger `#f77e7e` on surface | 6.94:1 | AA ✓ |
| `.loading-sub` = `--border` on `--bg` (`css/app.css:58`) | **1.43:1** | **fail** — "First load may take a few seconds" is the message a user on slow hotel Wi-Fi most needs, rendered nearly invisible |

Other checks:

- **Focus:** global `:focus-visible` outline ✓; modal focus trap ✓
  (`js/welcome.js:11-24`); Esc handled in modal, search, edit mode ✓.
- **Keyboard:** search combobox has full arrow/Enter/Esc support with ARIA
  (`js/search.js:80-100`) ✓; popup buttons are real `<button>`s ✓; canvas
  markers themselves unreachable (noted, accepted).
- **Touch targets:** `.ui-btn` ≈ 33px, `.session-btn` ≈ 29–31px,
  `.modal-btn` ≈ 38px, suggestion rows ≈ 40px, Leaflet zoom 26px — most of
  the chrome sits below the 44px guideline. The map itself compensates with
  generous canvas hit tolerance (12px touch, `js/map-setup.js:47`) and
  24px paint radius in edit mode (`js/ride-edit.js:66`) — the *map* is more
  finger-friendly than the *buttons*.
- **Type floor:** 9.5px (`popup-line-en`) and 10px × 7 rules — hint text,
  warnings, and the sync status all live below 11px. For a text-light app
  there is room to raise the floor to 11–12px without crowding anything.
- **ARIA:** labels, roles, `aria-live` regions, progressbar values all
  present and correct — clearly deliberate work. ✓

### 3.5 UI findings summary

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| U-1 | Major | Token input unstyled (= F-2) | `07-…png`, no CSS rule |
| U-2 | Major | Bottom-centre stacking collisions (= F-3) | `13/14-…png` |
| U-3 | Minor | 7 button / 4 input / 8 surface dialects | Phase 1.3 tables |
| U-4 | Minor | 17 ad-hoc alpha colors; 5 UI colors JS-only | Phase 1.4 |
| U-5 | Minor | `.loading-sub` contrast 1.43:1 | table above |
| U-6 | Minor | Sub-11px text tier (8 rules) | Phase 1.4 |
| U-7 | Minor | Chrome touch targets < 44px | measurements above |
| U-8 | Minor | No spacing/radius/type scale (24/9/10 values) | Phase 1.4 |

Severity note: U-3/U-4/U-8 are individually cosmetic but are *the* compound
interest generator — every future feature adds another dialect until the
brief's imagined mess becomes real. That is what Phase 4 (DESIGN_SYSTEM.md)
prevents.
