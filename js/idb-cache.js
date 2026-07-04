// ── 6b. INDEXEDDB CACHE ───────────────────────────────────────────────────

import { APP_VERSION } from './config.js';

const _dbReady = new Promise((res, rej) => {
    const req = indexedDB.open('eki-cache', 2);
    req.onupgradeneeded = e => e.target.result.createObjectStore('data');
    req.onsuccess = e => res(e.target.result);
    req.onerror   = rej;
});

export const cacheGet = async (key) => {
    const db  = await _dbReady;
    return new Promise((res, rej) => {
        const req = db.transaction('data').objectStore('data').get(key);
        req.onsuccess = () => res(req.result);
        req.onerror   = rej;
    });
};

export const cacheSet = async (key, val) => {
    const db  = await _dbReady;
    return new Promise((res, rej) => {
        const req = db.transaction('data', 'readwrite').objectStore('data').put(val, key);
        req.onsuccess = () => res();
        req.onerror   = rej;
    });
};

// Drop cache entries from other APP_VERSIONs (incl. the legacy unversioned
// 'eki_lines' key) so the DB doesn't grow ~15 MB per release forever.
export const cachePrune = async () => {
    try {
        const db    = await _dbReady;
        const store = db.transaction('data', 'readwrite').objectStore('data');
        const req   = store.getAllKeys();
        req.onsuccess = () => {
            const keep = new Set([`eki_lines_${APP_VERSION}`, `eki_stamp_stations_${APP_VERSION}`]);
            req.result.forEach(k => {
                if (typeof k === 'string' && !keep.has(k) &&
                    (k.startsWith('eki_lines') || k.startsWith('eki_stamp_stations_'))) store.delete(k);
            });
        };
    } catch { /* cache is best-effort */ }
};
