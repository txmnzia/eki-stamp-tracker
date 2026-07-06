# Design system recommendation — Eki Stamp Tracker (July 2026)

Phase 4 of the UX/UI audit (issue #21). Evidence base: `docs/AUDIT.md`.
Sequencing: `docs/OVERHAUL_PLAN.md`. **Proposal only — nothing here is
implemented.**

## 1. The recommendation

**Option 2: a custom token-based system — design tokens as CSS custom
properties plus a very small set of hand-built component classes.**
No web-component library, no framework migration.

This is not a diplomatic middle choice; the audit numbers force it:

- The entire app is **one screen, ~6 component types, ~3,500 lines total**,
  with a hard project rule against build steps (CLAUDE.md rule 5).
- The inconsistency found is **parallel dialects of one visual idea**
  (AUDIT.md §3.1) — 7 buttons trying to be the same button. The cure for
  that is one `.btn` class, not a component runtime.
- A token block **already exists** (`css/app.css:4-23`). The system is 60%
  born; it needs type/spacing/state tokens and enforcement, not replacement.

### Why not Option 1 (Shoelace / Web Awesome web components)

Honest tradeoffs: Shoelace would give accessible, themeable buttons, inputs,
dialogs and toasts with no rewrite, and it works from a CDN `<script>` tag,
which technically satisfies "no build step."

It still loses here:

- **The app uses ~6 component types, most exactly once.** Adding a
  ~100KB+ dependency (plus its FOUC-avoidance dance, `::part()` theming
  layer, and update cadence) to standardize six things is disproportionate.
- **CDN dependency is a known project pain**: the audit sandbox itself
  couldn't reach unpkg (`.claude/skills/run-and-verify` documents proxy 403s),
  and Leaflet-from-CDN is already the app's single point of failure. Adding
  a second runtime CDN dependency doubles that surface.
- **The app's identity is non-standard on purpose** — uppercase mono labels,
  cartographic dark chrome. Reskinning library components to look like this
  costs about as much CSS as writing the four primitives directly.
- Hard rule 7 (`esc()` everything, stored-XSS history) argues for *fewer*
  third-party DOM layers in the trust path, not more.

### Why not Option 3 (React + Mantine)

The gate the brief set — "only if the audit shows the codebase needs a
structural rewrite anyway" — **is not met.** The codebase was restructured
into tested ES modules *last month* (docs/REFACTOR-2026-07.md); it has unit
tests, a CI regression gate, zero dead CSS, and one dead constant. Cost if
done anyway: a build toolchain (violates CLAUDE.md rule 5), hosting/workflow
changes, a rewrite of ~2,000 lines of imperative Leaflet integration that
React does not improve (the map is not virtual-DOM-shaped), re-verification
of the 15-gap geometry baseline, and weeks of risk to the highest-stakes
code (state/sync, which had P0/P1 data-loss bugs fixed in the 2026-07
audit and must not regress). Benefit: component ergonomics the app barely
needs. Verdict: rejected without reservation.

## 2. Token spec

Principle: **name what exists and is earning its place; delete what isn't.**
The palette below is the app's current identity, formalized — deltas are
called out. All tokens live in `:root` in `css/app.css`; JS reads them via
`getComputedStyle` (or a single exported map in `js/config.js` mirroring
them) so the five JS-only colors (AUDIT.md §1.4) stop drifting.

### 2.1 Color — 6 named colors, 3 state alphas

| Token | Value | Role / justification |
|---|---|---|
| `--bg` | `#0f0f12` | page + map chrome base (exists) |
| `--surface` | `#18181e` | panels, popups, toasts (exists; `--surface2` `#22222a` kept as its single hover/inset step) |
| `--border` | `#2e2e3a` | hairlines (exists) |
| `--text` | `#e4e4ec` | primary text; `--muted` `#9898b0` remains the single secondary tier (exists) |
| `--accent` | `#7eb8f7` | interactive blue: focus, primary buttons, links, ride color fallback (exists) |
| `--ink` | `#e8543f` | *the product color*: stamped stations, progress. Originally specced as gold (`--stamp-on` heritage); changed to vermillion stamp-ink red at owner request during the v1.7 collect redesign — real eki stamps are red, and the marker glyph IS the stamp now |

Semantic accents (kept, now tokenized instead of hardcoded):
`--danger: #f77e7e`, `--success: #6fdd8b`.
Map-layer neutrals (new tokens for the JS-only values): `--marker-idle:
#9aa0ac`, `--line-unknown: #6b6b7a`.

**State alphas — the rule that kills the 17 ad-hoc rgba variants:** a hue may
appear at exactly three alphas: `--a-tint: 12%` (resting fill),
`--a-hover: 22%` (hover fill), `--a-outline: 35%` (border). Implemented once
via `color-mix(in srgb, var(--hue) N%, transparent)` — supported in all
evergreen browsers well before this app's baseline (it already uses
`env()`, `backdrop-filter`, `:focus-visible`). Any design that "needs" a
fourth alpha is redesigned, not excepted.

Deleted: `--stamp-off` (`#3a3a48`, no longer load-bearing once markers
tokenize), `#d4a830` (one-off hover gold → superseded with `--ink`),
`#3a2222` (one-off danger border → `--danger` outline alpha), `#888`
fallback (→ `--line-unknown`).

### 2.2 Type — 2 faces, 5 sizes, 2 weights

Faces (unchanged): `--ui-font` Space Mono — labels, numbers, buttons;
`--jp-font` Zen Kaku Gothic New — station/line names and any body-length
sentence. New rule attached to the tokens: **Space Mono never sets more
than one line of text** — multi-line copy (hints, explanations, modal
paragraphs) is Zen Kaku. This resolves the "documentation panel" texture of
the session panel at the type level.

| Token | Size / line | Replaces | Use |
|---|---|---|---|
| `--fs-xs` | 11px / 1.5 | 9.5px, 10px, 11px (**raises the floor — a11y U-6**) | badges, hints, sync status, uppercase labels |
| `--fs-sm` | 12px / 1.6 | 12px | body copy, toasts, suggestions |
| `--fs-md` | 14px / 1.5 | 13px, 14px | inputs, JP secondary names |
| `--fs-lg` | 17px / 1.4 | 16px, 17px | popup station names |
| `--fs-xl` | 20px / 1.3 | 18px, 20px | modal/section headings |

Weights: 400 and 700 (already the only two loaded). Letter-spacing collapses
from 7 values to 2: `--track-caps: 0.07em` (uppercase labels only) and
normal.

### 2.3 Spacing — one scale

`--sp-1: 4px · --sp-2: 8px · --sp-3: 12px · --sp-4: 16px · --sp-5: 24px`

24 distinct paddings map onto composites of these (audit table §1.4 is the
mapping worksheet: 7×10 → 8px 12px; 9×12 → 8px 12px; 14×16 → 12px 16px;
28px modal → 24px; etc.). Off-scale values are allowed only inside Leaflet
override rules, where we're matching library geometry we don't own.

### 2.4 Radii, shadows, motion

- **Radii:** `--r-sm: 4px` (inputs, badges), `--r-md: 8px` (all floating
  surfaces — panels, popups, modal, toast), `--r-full: 999px` (the Close
  pill; also adopts the stats bar). `50%` stays for circles. Deleted: 2, 3,
  6, 10, 20px. (Delta: surfaces move 6→8, modal 10→8, stats bar 20→full;
  imperceptible individually, coherent collectively.)
- **Shadows:** two elevations only. `--shadow-1: 0 4px 16px rgba(0,0,0,.45)`
  (attached chrome: search bar, toast, stats bar, tooltip);
  `--shadow-2: 0 12px 32px rgba(0,0,0,.55)` (floating: popup, panel, modal).
  Deletes the 6-recipe spread including the modal's `0 20px 60px`.
- **Motion:** `--t-fast: 120ms` (hover/color), `--t-move: 250ms ease`
  (position/opacity: toast slide, edit-mode dim, panel). Replaces the
  0.1–0.4s spread. Anything longer than 250ms must be a loading state, not
  a transition.

### 2.5 Z-index

Keep the existing `--z-map-ui / --z-modal / --z-toast / --z-loading` scale
exactly as is (`css/app.css:19-22`) — it's already correct; F-3's collisions
are *position* clashes, not z-order bugs.

## 3. Component inventory for v1

Six primitives cover >90% of the chrome. Each lists the current variants it
replaces (from AUDIT.md §1.3):

| # | Component | API (classes) | Replaces |
|---|---|---|---|
| 1 | **Button** `.btn` | tones: `--primary` (accent tint), `--quiet` (surface, default), `--danger`; sizes: default, `--sm`; states: `.is-active`, `.is-armed` (absorbs `confirm-pending`), `.is-on` (absorbs `collected`/`has-rides`); layout: `--block` (popup full-width), `--pill` (Close) | `.ui-btn`, `.session-btn` (+3 states), `.modal-btn` (+2), `.popup-collect-btn` (+1), `.popup-line-ride-btn` (+1), `#ride-edit-close` — 7 families → 1 |
| 2 | **Input** `.input` | one recipe: surface2 fill, border, `--r-sm`, focus→accent; modifier `--lg` for the modal's JP-sized field | 4 treatments incl. the unstyled token field (F-2 fixed by construction) |
| 3 | **Surface** `.card` | `--r-md` + `--shadow-2` + border; modifier `--flat` (`--shadow-1`) | 8 hand-rolled recipes |
| 4 | **Popup content** | keep `buildPopupHtml` exactly as engine; its internals adopt btn/type tokens | already unified — the model citizen |
| 5 | **Toast** `.toast` | default + `--error` variant (F-11); `max-width` + wrapping (F-7); owns the bottom-slot stacking contract with the stats bar and Close pill (F-3) | current single-style `#toast` |
| 6 | **Field row** `.field` | label + control + one optional hint line (`--fs-xs`, muted, 1 line) | the session panel's label/input/warning stacks; enforces the copy diet structurally |

Explicitly *not* components: the map, markers, and line styles — they are
the product, tuned in `js/config.js`, and stay there. Their **colors** join
the tokens; their geometry tunables do not.

## 4. Design principles (the anti-rot contract)

Five principles; every future UI change must pass all of them. They are
written to be checkable in review, and mirror CLAUDE.md's hard-rules style:

1. **No values outside tokens.** New color, size, spacing, radius, shadow,
   or duration ⇒ change the token file or redesign — never inline. (Leaflet
   `!important` overrides are the sole exempt zone.)
2. **One primary action per surface.** Every screen, panel, popup, and modal
   has exactly one accent-toned action; everything else is quiet. If two
   things feel primary, the surface is two surfaces.
3. **The map is the interface.** New features must first attempt expression
   on the map (like ride painting did); panels are for setup, chrome is for
   glancing. Any proposal adding a second permanent panel is wrong until
   proven otherwise.
4. **Every state ships designed.** Loading, empty, error, and success for
   any new surface are specified before merge — and errors must say what
   happened *and* what to do next, in the `--error` toast variant or an
   inline message. "✗ error" alone doesn't pass review.
5. **Copy is a control, not a manual.** UI text ≤ 1 line per element (hint
   rows), buttons name their exact outcome in the user's vocabulary
   ("Save progress", never "Submit"), warnings appear at most once, and
   anything longer moves behind a disclosure or link.

## 5. Cost & shape of adoption

The entire token layer + six primitives is an estimated **~250 lines of CSS**
replacing ~300 of the current 365 — the system *shrinks* the stylesheet.
No new files beyond what `css/app.css` already is; no JS architecture
change; `buildPopupHtml` and all Leaflet integration untouched. Rollout
order, risk, and verification per step: `docs/OVERHAUL_PLAN.md` Phase B–C.
