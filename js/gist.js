// ── 4. GIST PERSISTENCE ───────────────────────────────────────────────────
// NOTE: notify.js imports syncToGist for its retry link while this module
// imports setSyncStatus — a deliberate runtime-only cycle (safe: neither
// binding is touched during module evaluation).

import { GIST_PREFIX, SYNC_DEBOUNCE_MS } from './config.js';
import { state, getToken, sanitizeRides, persistLocal } from './state.js';
import { setSyncStatus } from './notify.js';

let syncDebounce = null;

// The session panel needs to flush/inspect the pending debounced save
// without owning the timer.
export const isSyncDirty = () => syncDirty;
export const cancelPendingSync = () => clearTimeout(syncDebounce);

/**
 * Fetch with JSON response — validates HTTP status before parsing.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>} parsed JSON
 * @throws {Error} on non-2xx response or network failure
 */
const apiFetch = async (url, options = {}) => {
    const token = getToken();
    const resp = await fetch(url, {
        ...options,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
                   'Content-Type': 'application/json', ...options.headers }
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const err  = new Error(`GitHub API ${resp.status}: ${text.slice(0, 120)}`);
        err.status = resp.status;
        throw err;
    }
    return resp.json();
};

/** Find the Gist ID for a username. Returns null if not found. */
const findGistId = async (username, fresh = false) => {
    const cacheKey = `eki_gist:${username}`;
    if (!fresh) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return cached;
    }
    let page = 1;
    while (true) {
        const gists = await apiFetch(`https://api.github.com/gists?per_page=100&page=${page}`);
        const found = gists.find(g => g.description === GIST_PREFIX + username);
        if (found) { localStorage.setItem(cacheKey, found.id); return found.id; }
        if (gists.length < 100) return null;
        page++;
    }
};

// Track whether local changes exist that haven't reached the Gist yet, so a
// session switch can flush them first instead of dropping them.
let syncDirty = false;

/**
 * Load stamps+rides from the Gist for the given username.
 * @param {boolean} [opts.mergeLocal] union the current local progress into the
 *   loaded data (used when an anonymous user claims a sync name, so their
 *   local stamps are never wiped by the load).
 */
export const loadFromGist = async (username, { mergeLocal = false } = {}) => {
    // A pending debounced save must never fire mid-load and write one
    // session's data into another session's gist.
    clearTimeout(syncDebounce);
    if (!getToken()) {   // local-only mode: nothing remote to load, and the
        state.gistId = null;   // device's own data is never cleared
        persistLocal();
        setSyncStatus('local');
        return;
    }
    setSyncStatus('saving');
    const localStamps = mergeLocal ? new Set(state.stamps) : null;
    const localRides  = mergeLocal ? state.rides : null;
    try {
        let gistId = await findGistId(username);
        let data   = { stamps: [], rides: {} };
        if (gistId) {
            let gist;
            try {
                gist = await apiFetch(`https://api.github.com/gists/${gistId}`);
            } catch (err) {
                if (err.status !== 404) throw err;
                // Stale cached id (gist deleted elsewhere) — rediscover once.
                localStorage.removeItem(`eki_gist:${username}`);
                gistId = await findGistId(username, true);
                if (gistId) gist = await apiFetch(`https://api.github.com/gists/${gistId}`);
            }
            const raw = gist?.files?.['stamps.json']?.content;
            if (raw) data = JSON.parse(raw);
        }
        state.stamps = new Set(Array.isArray(data.stamps) ? data.stamps.filter(s => typeof s === 'string') : []);
        state.rides  = sanitizeRides(data.rides);
        state.gistId = gistId;   // only set once the content fetch has succeeded
        if (mergeLocal && (localStamps.size || Object.keys(localRides).length)) {
            localStamps.forEach(c => state.stamps.add(c));
            Object.entries(localRides).forEach(([ln, arr]) => {
                state.rides[ln] = [...new Set([...(state.rides[ln] || []), ...arr])];
            });
            scheduleSave();   // push the merged result back up
        }
        persistLocal();
        setSyncStatus('saved');
    } catch (err) {
        console.error('loadFromGist:', err);
        setSyncStatus('error', err);
    }
};

/** Persist current stamps+rides (always locally; to the Gist when possible). */
export const syncToGist = async () => {
    persistLocal();
    if (!state.user) return;
    if (!getToken()) { setSyncStatus('local'); return; }
    // Snapshot identity + payload NOW: if the user switches session while this
    // request is in flight, we still write the OLD data to the OLD gist rather
    // than cross-contaminating the new one.
    const user    = state.user;
    const content = JSON.stringify({ stamps: [...state.stamps], rides: state.rides });
    let   gistId  = state.gistId;
    setSyncStatus('saving');
    try {
        if (gistId) {
            try {
                await apiFetch(`https://api.github.com/gists/${gistId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ files: { 'stamps.json': { content } } })
                });
            } catch (err) {
                if (err.status !== 404) throw err;
                // Gist deleted elsewhere — forget it and fall through to create.
                localStorage.removeItem(`eki_gist:${user}`);
                if (state.gistId === gistId) state.gistId = null;
                gistId = null;
            }
        }
        if (!gistId) {
            const gist = await apiFetch('https://api.github.com/gists', {
                method: 'POST',
                body: JSON.stringify({ description: GIST_PREFIX + user, public: false, files: { 'stamps.json': { content } } })
            });
            if (!gist.id) throw new Error('Gist response missing id');
            if (state.user === user) state.gistId = gist.id;
            localStorage.setItem(`eki_gist:${user}`, gist.id);
        }
        syncDirty = false;
        setSyncStatus('saved');
    } catch (err) {
        console.error('syncToGist:', err);
        setSyncStatus('error', err);
    }
};

export const scheduleSave = () => {
    persistLocal();
    syncDirty = true;
    clearTimeout(syncDebounce);
    setSyncStatus(getToken() ? 'saving' : 'local');
    syncDebounce = setTimeout(syncToGist, SYNC_DEBOUNCE_MS);
};
