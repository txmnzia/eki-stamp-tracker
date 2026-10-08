// ── 4a. SYNC MERGE (pure) ─────────────────────────────────────────────────
// Set algebra behind cloud sync. No DOM, no network, no app state, so it is
// unit-tested by node --test (tests/sync-merge.test.mjs).

// Rides flatten to "line<TAB>segKey" items; line names never contain a tab.
const SEP = '\t';

/** stamps (iterable of codes) + rides ({ line: [keys] }) → { stamps:Set, rides:Set } */
export const toItems = (stamps, rides) => ({
    stamps: new Set(stamps),
    rides:  new Set(Object.entries(rides || {}).flatMap(([ln, ks]) => ks.map(k => ln + SEP + k))),
});

export const rideItem = (line, seg) => line + SEP + seg;

export const splitRideItem = (item) => {
    const i = item.indexOf(SEP);
    return [item.slice(0, i), item.slice(i + 1)];
};

/** Set of ride items → { line: [keys] } */
export const fromRideItems = (items) => {
    const out = {};
    items.forEach(it => { const [ln, k] = splitRideItem(it); (out[ln] ||= []).push(k); });
    return out;
};

/**
 * Three-way merge: apply the local edits made since `base` onto `remote`.
 * Removed locally since base → removed; added locally since base → added;
 * everything else keeps the remote truth (so other devices' edits survive).
 * An empty base (first sign-in on a device) is a plain union: local progress
 * is never dropped.
 */
export const merge3 = (remote, local, base) => {
    const out = new Set(remote);
    base.forEach(x => { if (!local.has(x)) out.delete(x); });
    local.forEach(x => { if (!base.has(x)) out.add(x); });
    return out;
};

/** Items in a but not in b. */
export const minus = (a, b) => [...a].filter(x => !b.has(x));

export const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
