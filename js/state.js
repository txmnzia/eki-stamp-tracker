// ── 3a. APP STATE ─────────────────────────────────────────────────────────
// User-progress state and its persistence. Local-first: every change is
// mirrored to localStorage; the cloud (js/cloud.js, when signed in) is a
// mirror that merges, never replaces.

// Drop anything that isn't a { lineName: [string keys] } map — malformed ride
// data (bad import, hand-edited row) must never break overlay rendering.
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
    lang:   localStorage.getItem('eki_lang') || 'en',
    user:   '',   // signed-in account email ('' = not signed in); owned by js/cloud.js
    stamps: new Set(),
    rides:  {},   // lineName(kanji) -> ["codeA|codeB", ...] ridden segment keys
};

// ── Local-first persistence: progress always lives on the device too, so a
//    signed-out user's stamps survive a refresh and a signed-in user still has
//    their data when offline.
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

// Leftovers of the retired Gist sync: the per-user GitHub token is a
// credential, so it must not linger on the device once the feature is gone.
try {
    ['eki_gh_token', 'eki_current_user'].forEach(k => localStorage.removeItem(k));
    Object.keys(localStorage).filter(k => k.startsWith('eki_gist:')).forEach(k => localStorage.removeItem(k));
} catch { /* storage blocked */ }

// Persist a state key and trigger any required side effects
export const setState = (key, value) => {
    state[key] = value;
    if (key === 'lang') localStorage.setItem('eki_lang', value);
};
