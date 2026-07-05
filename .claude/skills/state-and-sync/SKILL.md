---
name: state-and-sync
description: User-data persistence and Gist sync for the Eki Stamp Tracker — the state model (stamps/rides), localStorage local-first mirroring, and the per-user GitHub Gist sync in js/state.js, js/gist.js, js/session.js. Use when touching state.js, gist.js, session.js, welcome.js, import/export/reset, loadFromGist/syncToGist/scheduleSave, or when debugging lost stamps, wrong-session writes, broken ride overlays after import, or "✗ sync error". This is the highest-stakes area: a 2026-07 audit found one P0 and three P1 data-loss bugs here; the fixes are load-bearing and must never regress.
---

# State & sync (user data — handle with care)

Every bug class in this area has already happened once (see `docs/AUDIT-2026-07.md`
Blocks 0–1, all fixed in v1.4.0). The rules below are regression guards, not style.

## Quick reference

**The state model** (`js/state.js`, exported `state`):

| Key | Type | Persisted where |
|---|---|---|
| `state.lang` | `'en'`/`'jp'` | localStorage `eki_lang` (via `setState`) |
| `state.user` | sync-name string, `''` = anonymous | localStorage `eki_current_user` (via `setState`) |
| `state.gistId` | gist id or `null` | memory only — rediscovered per session |
| `state.stamps` | `Set` of station codes (`eki_*`, `fk_*`) | localStorage `eki_local_progress` (via `persistLocal`) |
| `state.rides` | `{ lineNameKanji: ["codeA\|codeB", …] }` | localStorage `eki_local_progress` (via `persistLocal`) |

- Write scalars via `setState(key, value)`; mutate `stamps`/`rides` directly, then
  call `scheduleSave()` (which calls `persistLocal()` immediately).
- `state.js` hydrates `stamps`/`rides` from `eki_local_progress` at **module load**
  (top-level code), so anonymous progress survives reload with no init call.
- Ride values are **segment keys** `"codeA|codeB"` (two station codes, sorted,
  joined with `|`). `renderRideOverlays` (`js/rides.js`) also still renders the
  legacy format — a plain array of station codes — so old saved rides keep working.
  Never drop the legacy branch.
- Other localStorage keys: `eki_gh_token` (the user's own gist-scope PAT),
  `eki_gist:<user>` (cached gist id per sync name).

**The sync architecture** (`js/gist.js`):

- Per-user **BYO token**: `getToken()`/`setToken()` (`js/state.js`) read/write
  `eki_gh_token`. No token ⇒ fully functional local-only mode (`setSyncStatus('local')`).
- The gist is found by **description**: `GIST_PREFIX + user`
  (`GIST_PREFIX = 'eki-stamp-tracker:'` in `js/config.js`). `findGistId` paginates
  `GET /gists`, caches the hit in `eki_gist:<user>`, and takes `fresh=true` to bypass
  the cache. Both `loadFromGist` and `syncToGist` **drop the cached id on a 404**
  (gist deleted elsewhere) and rediscover / fall through to create — AUDIT 1.4.
- `scheduleSave()` = `persistLocal()` now + debounced `syncToGist` after
  `SYNC_DEBOUNCE_MS` (2000 ms). `isSyncDirty()` / `cancelPendingSync()` are the only
  external handles on the debounce (used by `js/session.js`).
- `syncToGist()` is a **full-content replace**: it PATCHes the entire
  `stamps.json` file (`{stamps:[…], rides:{…}}`). There is no server-side merge —
  whatever is in `state` at snapshot time overwrites the gist. That is why the
  merge/flush rules below exist.
- `sanitizeRides()` (`js/state.js`) must run on **every rides ingress**: boot
  hydrate (state.js), `loadFromGist` (gist.js), JSON import (session.js). A
  malformed value (non-array, non-strings) used to throw inside
  `renderRideOverlays` and break ALL overlay rendering — AUDIT 1.6.

## The five regression landmines (MUST / NEVER)

1. **NEVER embed or share a credential — however obfuscated.** v1.3 shipped an
   XOR-obfuscated shared GitHub PAT to evade secret scanning; anyone could decode
   it and read/overwrite every user's data (AUDIT 0.1). The old token is still in
   git history — treat it as compromised forever; per-user gist-scope token in
   localStorage is the only model.
2. **MUST mirror every stamps/rides mutation to localStorage** (`persistLocal`,
   already inside `scheduleSave`). Anonymous progress used to live only in memory
   and evaporate on refresh (AUDIT 1.1). Any new mutation path must call
   `scheduleSave()` (or at minimum `persistLocal()`).
3. **MUST merge (union), never replace, when a load meets local unsynced
   progress.** "Load session" used to wipe the very stamps the user was trying to
   claim (AUDIT 1.2). `loadFromGist(name, { mergeLocal: true })` unions stamps and
   per-line ride keys. The four call sites and their deliberate semantics:
   | Call site | `mergeLocal` | Why |
   |---|---|---|
   | welcome modal claim (`js/welcome.js`) | `true` | anonymous progress must survive the claim |
   | token-change reload (`js/session.js`) | `true` | never lose local progress |
   | "Load session" (`js/session.js`) | `!prevUser` | anonymous→named merges; **named→named deliberately replaces** (dirty changes are flushed to the *previous* user's gist first via `isSyncDirty()`/`cancelPendingSync()`/`await syncToGist()`) |
   | returning-user boot (`js/main.js`) | absent (`false`) | **deliberate replace**: the gist is the source of truth across devices, so un-collections made elsewhere propagate |
   Any NEW entry point must decide `mergeLocal` this consciously — default to
   `true` whenever local unsynced progress can exist.
   Known residual loss window (accepted, don't widen it): merged progress rides
   on the 2 s `scheduleSave` debounce and there is no `beforeunload`/`pagehide`
   flush, so killing the tab within ~2 s of a claim can leave the gist stale
   until the next local-mirrored boot.
4. **MUST clear the debounce before a session switch, and set `state.gistId` only
   after the content fetch succeeds.** A pending debounced save once fired mid-load
   and wrote user A's stamps into user B's gist (AUDIT 1.3). The guards:
   `clearTimeout(syncDebounce)` at the top of `loadFromGist`; `state.gistId = gistId`
   only after the fetch; `syncToGist` snapshots `user`/`content`/`gistId` at entry;
   `session-load` flushes dirty changes (`isSyncDirty()` → `cancelPendingSync()` +
   `await syncToGist()`) before switching users. Removing any one reopens the race.
5. **MUST clear stamps AND rides on reset** (and keep the button label saying so).
   They are one dataset in export/import/gist; reset once cleared only stamps
   (AUDIT 1.5). Reset and import both use the `RESET_CONFIRM_MS` two-step confirm —
   destructive actions never fire on first tap.

## Manual test sequence (run after ANY change in this area)

Serve with `python3 -m http.server 8000`, open `http://localhost:8000/index.html`
(no token needed for tests 1–2; the `run-and-verify` skill covers headless driving).

1. **Anonymous survives reload:** skip the welcome modal → collect a stamp →
   reload → the stamp is still gold, and localStorage `eki_local_progress`
   contains it.
2. **Claim merges:** collect a stamp anonymously → Session panel → type a new
   sync name → Load session → the local stamp is still collected (merged, not
   wiped by the empty/loaded gist).
3. **No cross-gist write** (needs a token): collect a stamp, then within 2 s
   load a *different* session name → verify (gist history on github.com) that
   session A's gist never received session B's data and vice versa.
4. **Malformed rides don't break rendering:** in devtools, set
   `localStorage.eki_local_progress = JSON.stringify({stamps:[],rides:{bad:42}})`
   → reload → no console error, other overlays still render (the bad entry is
   silently dropped by `sanitizeRides`).

Tests 1, 2 and 4 can be exercised headlessly by dynamic-importing the real module
in the page: `await import('/js/state.js')` in `page.evaluate` returns the live
singleton (`state`, `persistLocal`, `sanitizeRides`). Verified working in this
repo's sandbox (the app page itself needs Leaflet — see the `ride-gap-audit`
skill's `CDN_LOCAL` note if the CDN is unreachable).

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Progress gone after reload (anonymous) | A mutation path skipped `scheduleSave`/`persistLocal` | Add the call at the mutation site (see landmine 2) |
| User says stamps vanished after "loading my session" | First check `localStorage.eki_current_user` — if a stale sync name was set, the user wasn't anonymous, so `mergeLocal: !prevUser` was `false` and the load replaced; their stamps were flushed to the *previous* name's gist (check its revision history) | Expected semantics (landmine 3 table); recover from the previous gist / local export |
| Loading a session wiped local stamps | A NEW entry point calls `loadFromGist` without `mergeLocal` when local progress exists | Pass `{ mergeLocal: true }` (landmine 3) |
| One user's stamps in another user's gist | Debounce not cleared / `gistId` set before fetch / snapshot removed | Restore the three guards in landmine 4 |
| Permanent "✗ sync error", retry useless | Cached `eki_gist:<user>` points at a deleted gist and the 404-drop path was broken | Both 404 handlers in `js/gist.js` must remove the cache key and rediscover/create |
| All ride overlays vanish after an import | `sanitizeRides` missing on an ingress path | Call it wherever `state.rides` is assigned from external data |
| Sync writes with someone else's gists listed | Token changed but stale `eki_gist:*` caches survive | The token `change` handler in `js/session.js` purges every `eki_gist:*` key — keep it |

## Checklist before you're done

- [ ] Every new `state.stamps`/`state.rides` mutation calls `scheduleSave()`.
- [ ] Every new `loadFromGist` call site decided `mergeLocal` deliberately.
- [ ] Every assignment of `state.rides` from external data goes through `sanitizeRides`.
- [ ] No credential (token, gist id of another account) appears in code, comments, or fixtures.
- [ ] Manual tests 1–2 and 4 pass; test 3 if you touched `gist.js`.
- [ ] Destructive UI actions still use the two-step `RESET_CONFIRM_MS` confirm.
