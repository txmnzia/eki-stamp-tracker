// ── 13. SESSION PANEL ─────────────────────────────────────────────────────

import { APP_VERSION, RESET_CONFIRM_MS } from './config.js';
import { state, setState, getToken, setToken, sanitizeRides } from './state.js';
import { loadFromGist, syncToGist, isSyncDirty, cancelPendingSync } from './gist.js';
import { showToast, setSyncStatus } from './notify.js';
import { refreshAllMarkerStates } from './markers.js';
import { renderAllRideOverlays } from './rides.js';
import { updateStats } from './stats.js';

const showInputMode = () => {
    document.getElementById('session-loaded-row').classList.add('hidden');
    document.getElementById('session-input-section').classList.remove('hidden');
    document.getElementById('session-load-row').classList.remove('hidden');
    document.getElementById('session-save-row').classList.add('hidden');
};

const showLoadedMode = () => {
    document.getElementById('session-loaded-row').classList.remove('hidden');
    document.getElementById('session-input-section').classList.add('hidden');
    document.getElementById('session-load-row').classList.add('hidden');
    document.getElementById('session-save-row').classList.remove('hidden');
    document.getElementById('session-loaded-name').textContent = state.user;
};

export const updateSessionUI = () => {
    const avatar   = document.getElementById('session-avatar');
    const username = document.getElementById('session-username');
    const input    = document.getElementById('session-name-input');
    if (state.user) {
        avatar.textContent = state.user.charAt(0).toUpperCase();
        username.textContent = state.user;
        username.classList.remove('placeholder');
        if (input) input.value = state.user;
        showLoadedMode();
    } else {
        avatar.textContent = '?';
        username.textContent = 'No session';
        username.classList.add('placeholder');
        showInputMode();
    }
    updateStats();
};

export const setupSessionPanel = (map) => {
    const sv = document.getElementById('session-version');
    if (sv) sv.textContent = APP_VERSION;
    // Toggle panel open/close
    document.getElementById('session-toggle').addEventListener('click', () => {
        const panel = document.getElementById('session-panel');
        const btn   = document.getElementById('session-toggle');
        const open  = panel.classList.toggle('hidden') === false;
        btn.classList.toggle('active', open);
        btn.setAttribute('aria-expanded', open.toString());
    });

    updateSessionUI();

    // Change session
    document.getElementById('session-change').addEventListener('click', () => {
        showInputMode();
        const input = document.getElementById('session-name-input');
        input.value = state.user;
        input.focus();
    });

    // Sync token (per-user; enables cloud sync)
    const tokenInput = document.getElementById('session-token-input');
    tokenInput.value = getToken();
    tokenInput.addEventListener('change', async () => {
        setToken(tokenInput.value);
        // Cached gist ids may belong to a different account — forget them all.
        Object.keys(localStorage).filter(k => k.startsWith('eki_gist:')).forEach(k => localStorage.removeItem(k));
        if (getToken() && state.user) {
            showToast('Token saved — syncing…');
            await loadFromGist(state.user, { mergeLocal: true });   // never lose local progress
            refreshAllMarkerStates();
            renderAllRideOverlays();
        } else {
            setSyncStatus(getToken() ? '' : 'local');
            showToast(getToken() ? 'Token saved' : 'Token removed — local-only mode');
        }
    });

    // Load session
    document.getElementById('session-load').addEventListener('click', async () => {
        const name = document.getElementById('session-name-input').value.trim();
        if (!name) { showToast('Enter a sync name first'); return; }
        const prevUser = state.user;
        // Flush any unsynced changes of the PREVIOUS session before switching,
        // so they aren't dropped (or written into the new session's gist).
        if (prevUser && prevUser !== name && isSyncDirty()) { cancelPendingSync(); await syncToGist(); }
        setState('user', name);
        updateSessionUI();
        // Tokenless "load" fetches nothing — it names the local collection.
        // Say that, instead of implying a cloud round-trip (docs/AUDIT.md F-10).
        if (getToken()) showToast(`Loading ${name}…`);
        // Anonymous progress being claimed under a name must be merged in,
        // never wiped by whatever the (possibly empty) gist holds.
        await loadFromGist(name, { mergeLocal: !prevUser });
        refreshAllMarkerStates();
        renderAllRideOverlays();
        showToast(getToken() ? `Session loaded: ${name}` : `Collecting as ${name} on this device`);
    });

    // Save progress
    document.getElementById('session-save').addEventListener('click', async () => {
        if (!state.user) { showToast('Load a session first'); return; }
        cancelPendingSync();
        await syncToGist();
        showToast(getToken() ? `✓ Synced as ${state.user}` : 'Saved on this device (add a token to sync)');
    });

    // Export JSON
    document.getElementById('session-export').addEventListener('click', () => {
        const payload = { user: state.user, stamps: [...state.stamps], rides: state.rides };
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const a   = Object.assign(document.createElement('a'), {
            href: url,
            download: `eki-${state.user || 'stamps'}-${new Date().toISOString().slice(0, 10)}.json`
        });
        a.click();
        URL.revokeObjectURL(url);  // free memory
    });

    // Import JSON — replaces current data, so when data exists it uses the
    // same two-step confirm as Reset (imports are rare; overwrites are not
    // reversible once the sync fires).
    let importArmTimer = null;
    const importBtn = document.getElementById('session-import');
    const disarmImport = () => {
        clearTimeout(importArmTimer);
        delete importBtn.dataset.confirming;
        importBtn.textContent = 'Import JSON';
        importBtn.classList.remove('confirm-pending');
    };
    importBtn.addEventListener('click', () => {
        const hasData = state.stamps.size || Object.keys(state.rides).length;
        if (hasData && !importBtn.dataset.confirming) {
            importBtn.dataset.confirming = '1';
            importBtn.textContent = 'Replace current data?';
            importBtn.classList.add('confirm-pending');
            importArmTimer = setTimeout(disarmImport, RESET_CONFIRM_MS);
            return;
        }
        disarmImport();
        document.getElementById('session-import-file').click();
    });

    document.getElementById('session-import-file').addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => showToast('Could not read file', 2400, 'error');
        reader.onload  = async (ev) => {
            // Clear input AFTER read so same file can be re-imported
            e.target.value = '';
            try {
                const data = JSON.parse(ev.target.result);
                if (!Array.isArray(data.stamps)) throw new Error('Missing stamps array');
                state.stamps = new Set(data.stamps.filter(s => typeof s === 'string'));
                state.rides  = sanitizeRides(data.rides);
                if (data.user && !state.user) {
                    setState('user', data.user);
                    updateSessionUI();
                }
                refreshAllMarkerStates();
                renderAllRideOverlays();
                showToast(`Imported ${state.stamps.size} stamps`);
                await syncToGist();
            } catch (err) {
                console.error('Import:', err);
                showToast('Import failed — check it is an Eki JSON export', 4000, 'error');
            }
        };
        reader.readAsText(file);
    });

    // Reset — two-step confirmation (no browser confirm() dialog)
    let resetConfirmTimer = null;
    const resetBtn = document.getElementById('session-reset');
    resetBtn.addEventListener('click', async () => {
        if (!resetBtn.dataset.confirming) {
            resetBtn.dataset.confirming = '1';
            resetBtn.textContent = 'Tap again to confirm reset';
            resetBtn.classList.add('confirm-pending');
            resetConfirmTimer = setTimeout(() => {
                delete resetBtn.dataset.confirming;
                resetBtn.textContent = 'Reset stamps & rides';
                resetBtn.classList.remove('confirm-pending');
            }, RESET_CONFIRM_MS);
            return;
        }
        clearTimeout(resetConfirmTimer);
        delete resetBtn.dataset.confirming;
        resetBtn.textContent = 'Reset stamps & rides';
        resetBtn.classList.remove('confirm-pending');
        // Stamps and rides are one dataset everywhere else (export/import/
        // sync), so reset clears both — the button says so.
        state.stamps.clear();
        state.rides = {};
        await syncToGist();
        refreshAllMarkerStates();
        renderAllRideOverlays();
        showToast('All progress reset');
    });
};
