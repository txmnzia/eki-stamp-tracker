// ── 4. CLOUD SYNC (Supabase) ──────────────────────────────────────────────
// Magic-link account + per-item rows (eki.stamps / eki.rides) on the shared
// txmnzia-dbs project. Every sync is a pull + three-way merge + push of the
// diff, so devices never clobber each other. Runtime-only cycle with
// notify.js (retry link → syncNow), as the old gist.js had.

import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_SCHEMA, SUPABASE_JS_URL,
         SYNC_DEBOUNCE_MS } from './config.js';
import { state, sanitizeRides, persistLocal } from './state.js';
import { toItems, fromRideItems, merge3, minus, sameSet, rideItem, splitRideItem } from './sync-merge.js';
import { setSyncStatus } from './notify.js';

const PAGE  = 1000;   // PostgREST max rows per select (project default)
const CHUNK = 100;    // codes per delete .in() filter, keeps URLs short
const BASE_KEY = (uid) => `eki_sync_base:${uid}`;

let clientP      = null;    // Promise<SupabaseClient|null>, created once
let uid          = null;    // signed-in user id, null when signed out
let syncDebounce = null;
let syncDirty    = false;   // local changes not yet confirmed in the cloud
let running      = null;    // in-flight sync promise (syncs never overlap)
let rerun        = false;
const authListeners = [];
let onApplied = () => {};

export const isSyncDirty       = () => syncDirty;
export const cancelPendingSync = () => clearTimeout(syncDebounce);
export const isSignedIn        = () => !!uid;
/** Called after a sync changed local state (session.js repaints markers/overlays). */
export const setOnRemoteApplied = (fn) => { onApplied = fn; };
/** fn(signedIn:boolean) on every auth change, incl. the initial session. */
export const onAuthChange = (fn) => { authListeners.push(fn); };

// supabase-js is loaded lazily from the CDN: if that fails (offline, blocked)
// the app stays fully usable in local-only mode.
const getClient = () => clientP ??= (async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    try {
        const { createClient } = await import(SUPABASE_JS_URL);
        return createClient(SUPABASE_URL, SUPABASE_KEY, {
            db:   { schema: SUPABASE_SCHEMA },
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
    } catch (err) {
        console.error('Supabase client:', err);
        return null;
    }
})();

export const cloudAvailable = async () => !!(await getClient());

const readBase = (id) => {
    try {
        const b = JSON.parse(localStorage.getItem(BASE_KEY(id)) || 'null');
        if (b && Array.isArray(b.stamps) && Array.isArray(b.rides)) return { stamps: new Set(b.stamps), rides: new Set(b.rides) };
    } catch { /* corrupt → treat as first sync (union, never loses data) */ }
    return { stamps: new Set(), rides: new Set() };
};
const writeBase = (id, m) => {
    try { localStorage.setItem(BASE_KEY(id), JSON.stringify({ stamps: [...m.stamps], rides: [...m.rides] })); }
    catch { /* storage full — next sync falls back to a union */ }
};

// supabase-js returns { data, error, status } instead of throwing.
const must = (res) => {
    if (res.error) {
        const err = new Error(res.error.message || 'Supabase error');
        err.status = res.status;
        throw err;
    }
    return res.data;
};

const selectAll = async (c, table, cols, order, me) => {
    const out = [];
    for (let from = 0; ; from += PAGE) {
        let q = c.from(table).select(cols).eq('user_id', me);
        order.forEach(col => { q = q.order(col); });
        const rows = must(await q.range(from, from + PAGE - 1));
        out.push(...rows);
        if (rows.length < PAGE) return out;
    }
};

const fetchRemote = async (c, me) => {
    const [stamps, rides] = await Promise.all([
        selectAll(c, 'stamps', 'code', ['code'], me),
        selectAll(c, 'rides', 'line,seg', ['line', 'seg'], me),
    ]);
    return {
        stamps: new Set(stamps.map(r => r.code)),
        rides:  new Set(rides.map(r => rideItem(r.line, r.seg))),
    };
};

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const pushDiff = async (c, me, remote, merged) => {
    const addStamps = minus(merged.stamps, remote.stamps);
    const delStamps = minus(remote.stamps, merged.stamps);
    const addRides  = minus(merged.rides, remote.rides);
    const delRides  = minus(remote.rides, merged.rides);
    for (const part of chunks(addStamps, 500)) {
        must(await c.from('stamps').upsert(part.map(code => ({ user_id: me, code })),
            { onConflict: 'user_id,code', ignoreDuplicates: true }));
    }
    for (const part of chunks(addRides, 500)) {
        must(await c.from('rides').upsert(part.map(it => { const [line, seg] = splitRideItem(it); return { user_id: me, line, seg }; }),
            { onConflict: 'user_id,line,seg', ignoreDuplicates: true }));
    }
    for (const part of chunks(delStamps, CHUNK)) {
        must(await c.from('stamps').delete().eq('user_id', me).in('code', part));
    }
    const delByLine = {};
    delRides.forEach(it => { const [line, seg] = splitRideItem(it); (delByLine[line] ||= []).push(seg); });
    for (const [line, segs] of Object.entries(delByLine)) {
        for (const part of chunks(segs, CHUNK)) {
            must(await c.from('rides').delete().eq('user_id', me).eq('line', line).in('seg', part));
        }
    }
};

const syncOnce = async () => {
    persistLocal();
    const c  = await getClient();
    const me = uid;   // snapshot: a sign-out mid-sync must never apply/write across accounts
    if (!c || !me) { setSyncStatus('local'); return; }
    setSyncStatus('saving');
    syncDirty = false;   // edits made from here on set it again (scheduleSave)
    const local0 = toItems(state.stamps, state.rides);
    try {
        const remote = await fetchRemote(c, me);
        const base   = readBase(me);
        const merged = {
            stamps: merge3(remote.stamps, local0.stamps, base.stamps),
            rides:  merge3(remote.rides,  local0.rides,  base.rides),
        };
        if (uid !== me) { syncDirty = true; return; }
        await pushDiff(c, me, remote, merged);
        if (uid !== me) { syncDirty = true; return; }
        writeBase(me, merged);
        // Re-apply anything the user changed while the requests were in flight.
        const localNow = toItems(state.stamps, state.rides);
        const fin = {
            stamps: merge3(merged.stamps, localNow.stamps, local0.stamps),
            rides:  merge3(merged.rides,  localNow.rides,  local0.rides),
        };
        if (!sameSet(fin.stamps, localNow.stamps) || !sameSet(fin.rides, localNow.rides)) {
            state.stamps = fin.stamps;
            state.rides  = sanitizeRides(fromRideItems(fin.rides));
            persistLocal();
            onApplied();
        }
        setSyncStatus(syncDirty ? 'saving' : 'saved');
    } catch (err) {
        syncDirty = true;
        console.error('Cloud sync:', err);
        setSyncStatus('error', err);
    }
};

/** Pull + merge + push now. Calls made while a sync runs coalesce into one rerun. */
export const syncNow = () => {
    if (running) { rerun = true; return running; }
    running = (async () => {
        try { do { rerun = false; await syncOnce(); } while (rerun); }
        finally { running = null; }
    })();
    return running;
};

/** Every stamps/rides mutation calls this: local mirror now, cloud on a debounce. */
export const scheduleSave = () => {
    persistLocal();
    syncDirty = true;
    clearTimeout(syncDebounce);
    if (!uid) { setSyncStatus('local'); return; }
    setSyncStatus('saving');
    syncDebounce = setTimeout(syncNow, SYNC_DEBOUNCE_MS);
};

/** Wire auth. Resolves once the initial session (incl. a magic-link return) is known. */
export const initCloud = async () => {
    const c = await getClient();
    if (!c) { authListeners.forEach(fn => fn(false)); setSyncStatus('local'); return; }
    await new Promise((resolve) => {
        c.auth.onAuthStateChange((event, session) => {
            const prev = uid;
            uid = session?.user?.id || null;
            state.user = session?.user?.email || '';
            authListeners.forEach(fn => fn(!!uid));
            // Never await supabase calls inside this callback (supabase-js
            // deadlock); defer the sync to the next task.
            if (uid && uid !== prev) setTimeout(syncNow, 0);
            if (!uid) setSyncStatus('local');
            resolve();
        });
    });
    // Pick up edits made on other devices when the tab comes back.
    document.addEventListener('visibilitychange', () => {
        if (uid && document.visibilityState === 'visible') syncNow();
    });
    window.addEventListener('online', () => { if (uid) syncNow(); });
};

/** Send a magic link that returns to this exact page. */
export const sendMagicLink = async (email) => {
    const c = await getClient();
    if (!c) throw new Error('Cloud sync is unavailable right now');
    must(await c.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname },
    }));
};

/**
 * Sign out of this device. Unsynced edits are flushed first; if that fails
 * the sign-out is refused so nothing is lost. After a clean flush the local
 * copy is cleared (it is safe in the cloud), so the next account to sign in
 * here doesn't inherit it.
 */
export const signOut = async () => {
    const c = await getClient();
    if (!c || !uid) return;
    cancelPendingSync();
    await syncNow();
    if (syncDirty) throw new Error('Could not sync your latest changes, so you are still signed in');
    must(await c.auth.signOut({ scope: 'local' }));
    uid = null;
    state.user = '';
    state.stamps = new Set();
    state.rides  = {};
    persistLocal();
    onApplied();
    authListeners.forEach(fn => fn(false));
    setSyncStatus('local');
};
