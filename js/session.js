// ── 13. SESSION PANEL ─────────────────────────────────────────────────────

import { APP_VERSION, RESET_CONFIRM_MS } from './config.js';
import { state, sanitizeRides } from './state.js';
import { scheduleSave, syncNow, cancelPendingSync, signOut, sendMagicLink,
         onAuthChange, setOnRemoteApplied, cloudAvailable } from './cloud.js';
import { showToast } from './notify.js';
import { refreshAllMarkerStates } from './markers.js';
import { renderAllRideOverlays } from './rides.js';
import { updateStats } from './stats.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const updateSessionUI = () => {
    const avatar   = document.getElementById('session-avatar');
    const username = document.getElementById('session-username');
    const signedIn = !!state.user;
    avatar.textContent = signedIn ? state.user.charAt(0).toUpperCase() : '?';
    username.textContent = signedIn ? state.user : 'Not signed in';
    username.classList.toggle('placeholder', !signedIn);
    document.getElementById('session-loaded-row').classList.toggle('hidden', !signedIn);
    document.getElementById('session-save-row').classList.toggle('hidden', !signedIn);
    document.getElementById('session-signin-form').classList.toggle('hidden', signedIn);
    document.getElementById('session-loaded-name').textContent = state.user;
    document.getElementById('session-loaded-name').title = state.user;
    updateStats();
};

// Repaint everything that reads stamps/rides after a sync changed them.
const repaintProgress = () => {
    refreshAllMarkerStates();
    renderAllRideOverlays();
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
    onAuthChange(() => updateSessionUI());
    setOnRemoteApplied(repaintProgress);

    // Magic-link sign-in. The account is the only identity: no names, no tokens.
    const form    = document.getElementById('session-signin-form');
    const emailIn = document.getElementById('session-email-input');
    const sendBtn = document.getElementById('session-signin');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailIn.value.trim();
        if (!EMAIL_RE.test(email)) { showToast('Enter a valid email', 2400, 'error'); emailIn.focus(); return; }
        if (!(await cloudAvailable())) { showToast('Cloud sync is unavailable (offline?)', 3000, 'error'); return; }
        sendBtn.disabled = true;
        try {
            await sendMagicLink(email);
            showToast(`Sign-in link sent to ${email} — open it on this device`, 5000);
        } catch (err) {
            console.error('Magic link:', err);
            showToast(err.status === 429 ? 'Too many requests — wait a minute and retry'
                                         : 'Could not send the link — try again', 4000, 'error');
        } finally {
            sendBtn.disabled = false;
        }
    });

    // Sign out (flushes first; refuses rather than lose unsynced changes).
    // If the flush fails the button arms a "sign out anyway" that keeps the
    // progress on this device, so a broken sync never traps the user.
    const outBtn = document.getElementById('session-signout');
    let outArmTimer = null;
    const disarmOut = () => {
        clearTimeout(outArmTimer);
        delete outBtn.dataset.force;
        outBtn.textContent = 'Sign out';
        outBtn.classList.remove('confirm-pending');
    };
    outBtn.addEventListener('click', async () => {
        const force = !!outBtn.dataset.force;
        disarmOut();
        try {
            await signOut({ force });
            updateSessionUI();
            showToast(force ? 'Signed out — progress kept on this device'
                            : 'Signed out — your progress is safe in your account');
        } catch (err) {
            showToast(err.message, 4000, 'error');
            if (!err.unsynced) return;
            outBtn.dataset.force = '1';
            outBtn.textContent = 'Sign out anyway (keeps progress here)';
            outBtn.classList.add('confirm-pending');
            outArmTimer = setTimeout(disarmOut, RESET_CONFIRM_MS * 2);
        }
    });

    // Sync now
    document.getElementById('session-save').addEventListener('click', async () => {
        cancelPendingSync();
        await syncNow();
    });

    // Export JSON
    document.getElementById('session-export').addEventListener('click', () => {
        const payload = { stamps: [...state.stamps], rides: state.rides };
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const a   = Object.assign(document.createElement('a'), {
            href: url,
            download: `eki-stamps-${new Date().toISOString().slice(0, 10)}.json`
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
                scheduleSave();   // local mirror now; the cloud gets the diff
                refreshAllMarkerStates();
                renderAllRideOverlays();
                showToast(`Imported ${state.stamps.size} stamps`);
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
        scheduleSave();
        refreshAllMarkerStates();
        renderAllRideOverlays();
        showToast('All progress reset');
    });
};
