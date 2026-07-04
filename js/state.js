// ── 3a. APP STATE ─────────────────────────────────────────────────────────
// User-progress state and its persistence. Local-first: every change is
// mirrored to localStorage; the Gist (when a token is set) is a mirror.

// ── Sync token: each user supplies their OWN GitHub token (gist scope only),
//    stored in localStorage on their device. Progress then syncs to a private
//    Gist on the user's own account. No shared credential is ever embedded in
//    this file: a baked-in token — however obfuscated — is readable by anyone
//    and would give them access to every user's data (and one shared API rate
//    limit). Without a token the app is fully usable in local-only mode.
const TOKEN_KEY         = 'eki_gh_token';
export const getToken          = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken          = (t) => { const v = (t || '').trim();
                                   if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); };
// Drop anything that isn't a { lineName: [string keys] } map — malformed ride
// data (bad import, hand-edited gist) must never break overlay rendering.
export const sanitizeRides = (r) => {
    const out = {};
    if (r && typeof r === 'object' && !Array.isArray(r)) {
        Object.entries(r).forEach(([k, v]) => {
            if (!Array.isArray(v)) return;
            const a = v.filter(x => typeof x === 'string');
            if (a.length) out[k] = a;
        });
    }
    return out;
};

// All mutable app state lives here. Read via state.*, write via setState().
export const state = {
    lang:   localStorage.getItem('eki_lang')         || 'en',
    user:   localStorage.getItem('eki_current_user') || '',
    gistId: null,
    stamps: new Set(),
    rides:  {},   // lineName(kanji) -> ["codeA|codeB", ...] ridden segment keys
};

// ── Local-first persistence: progress always lives on the device too, so an
//    anonymous user's stamps survive a refresh and a synced user still has
//    their data when offline. The Gist (when a token is set) is a mirror.
const LOCAL_KEY = 'eki_local_progress';
export const persistLocal = () => {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ stamps: [...state.stamps], rides: state.rides })); }
    catch { /* storage full/blocked — sync and export still work */ }
};
try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (saved) {
        state.stamps = new Set(Array.isArray(saved.stamps) ? saved.stamps.filter(s => typeof s === 'string') : []);
        state.rides  = sanitizeRides(saved.rides);
    }
} catch { /* corrupt entry — start clean */ }

// Persist a state key and trigger any required side effects
export const setState = (key, value) => {
    state[key] = value;
    if (key === 'lang')  localStorage.setItem('eki_lang',         value);
    if (key === 'user')  localStorage.setItem('eki_current_user', value);
};
