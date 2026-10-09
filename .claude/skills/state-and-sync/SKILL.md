---
name: state-and-sync
description: User-data persistence and Supabase cloud sync for the Eki Stamp Tracker — the state model (stamps/rides), localStorage local-first mirroring, magic-link auth, and the three-way-merge row sync in js/state.js, js/cloud.js, js/sync-merge.js, js/session.js. Use when touching any of those, import/export/reset, scheduleSave/syncNow/signOut, the eki schema (supabase/migrations), or when debugging lost stamps, cross-device overwrites, wrong-account writes, broken ride overlays after import, or '✗ sync failed'. Highest-stakes area: a 2026-07 audit found one P0 and three P1 data-loss bugs here; the guards are load-bearing.
---

# State & sync (user data — handle with care)

Gist sync was retired in v1.9.0 (it was the source of both token incidents,
`docs/AUDIT-2026-07.md` Block 0). Sync is now Supabase: shared project
**txmnzia-dbs**, schema `eki`, magic-link auth, RLS per user.

## Quick reference

**State** (`js/state.js`, exported `state`):

| Key | Type | Persisted where |
|---|---|---|
| `state.lang` | `'en'`/`'jp'` | localStorage `eki_lang` (via `setState`) |
| `state.user` | signed-in email, `''` = signed out | not persisted; set by `js/cloud.js` from the auth session |
| `state.stamps` | `Set` of station codes | localStorage `eki_local_progress` (`persistLocal`) |
| `state.rides` | `{ lineNameKanji: ["codeA\|codeB", …] }` | localStorage `eki_local_progress` (`persistLocal`) |

- Mutate `stamps`/`rides` directly, then call `scheduleSave()` (`js/cloud.js`):
  `persistLocal()` now + debounced `syncNow` after `SYNC_DEBOUNCE_MS` when signed in.
- Ride values are segment keys (`"codeA|codeB"`, sorted). Legacy rides are plain
  station-code arrays; `renderRideOverlays` still renders them. Never drop that branch.
- `state.js` purges the retired gist keys (`eki_gh_token`, `eki_current_user`,
  `eki_gist:*`) at load. Keep that: the token is a credential.

**Cloud** (`js/cloud.js`, pure helpers in `js/sync-merge.js`):

- Tables `eki.stamps(user_id, code)` and `eki.rides(user_id, line, seg)`, one row
  per item, PK on all columns, RLS `user_id = auth.uid()`
  (`supabase/migrations/0001_init.sql`).
- supabase-js is a pinned jsdelivr ESM loaded by dynamic `import()`; failure means
  `getClient()` → `null` → local-only. Never make the app depend on it at boot.
- `syncNow()`: pull all rows (paged, 1000/page) → `merge3(remote, local, base)` →
  push only the diff (upsert ignore-duplicates / delete by key) → store `base`
  (`eki_sync_base:<uid>`) → re-apply edits made while in flight → `onApplied()`
  repaints. Calls coalesce; syncs never overlap.
- Triggers: `scheduleSave` debounce, auth change to a new uid, tab
  `visibilitychange` → visible, `online`, the "Sync now" button, sync-error retry link.

## Regression landmines (MUST / NEVER)

1. **NEVER embed a secret.** Only the publishable key + URL go in `js/config.js`.
   The secret / service_role key never enters the repo. No per-user tokens either.
2. **MUST mirror every mutation locally** (`scheduleSave` or `persistLocal`).
   Signed-out progress lives only in localStorage (AUDIT 1.1).
3. **MUST merge, never replace.** Empty/missing base ⇒ `merge3` is a union, so a
   device's first sign-in never drops local progress (AUDIT 1.2). Never "load"
   remote over local wholesale.
4. **Account isolation.** `syncOnce` snapshots `uid` at entry and bails (keeping
   `syncDirty`) if it changed before writing or applying (AUDIT 1.3 equivalent).
   Writes always pass `user_id: me`; RLS rejects a mismatch anyway.
   `signOut` flushes first and **refuses** if the flush failed; only after a clean
   flush does it clear local state, so the next account doesn't inherit it.
   If the flush fails the button arms "Sign out anyway" (`signOut({ force: true })`),
   which signs out but KEEPS local state. Never let a broken sync trap the user.
5. **Reset clears stamps AND rides** (two-step `RESET_CONFIRM_MS` confirm); the
   diff then deletes them remotely. Import replaces local state then `scheduleSave`.
6. **`sanitizeRides` on every rides ingress**: boot hydrate, sync apply, import
   (AUDIT 1.6).
7. **Don't await supabase calls inside `onAuthStateChange`** (supabase-js
   deadlock); defer with `setTimeout`.

## Verify

- `node --test tests/*.test.mjs` covers `merge3` semantics (`tests/sync-merge.test.mjs`).
- The sandbox cannot reach `*.supabase.co` or jsdelivr. Headless end-to-end: route
  `https://cdn.jsdelivr.net/**` to an in-memory mock exporting `createClient`
  (`from().select/eq/in/order/range/upsert/delete`, `auth.onAuthStateChange/
  signInWithOtp/signOut`), with rows kept Node-side via `exposeFunction` so two
  browser contexts act as two devices. Check: signed-out survives reload; sign-in
  unions; device A's edit doesn't clobber device B's; edit during in-flight sync
  survives; reset deletes remotely; sign-out flushes then clears; second account
  sees nothing; malformed `eki_local_progress` rides are dropped.
- Live checks only the owner can do: magic link email arrives and returns signed
  in; rows appear in the Supabase table editor.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Magic link lands on the wrong page / not signed in | Redirect URL not allowed (falls back to Site URL) | Normally covered by the project-wide `https://txmnzia.github.io/**` entry; check it still exists in Auth > URL Configuration |
| `✗ sync failed (HTTP 406)` | `eki` not in Data API > **Exposed schemas** (happened at launch: it is easy to fill "Extra search path" instead, or not click Save) | Add it to Exposed schemas, Save, wait ~30 s, Retry |
| `✗ sync failed (HTTP 404)` | Migration not run (tables missing) | Run `supabase/migrations/0001_init.sql` |
| `✗ signed out — sign in again` | 401/403: session expired or RLS rejected | Sign in again; check policies |
| Status stays "saved on this device" when signed in elsewhere | CDN blocked → client null | Expected local-only fallback |
| Edits from another device don't show | No sync since tab focus | "Sync now"; visibility trigger should cover it |
| Overlays vanish after import | `sanitizeRides` missing on an ingress | Add it |
