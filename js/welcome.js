// ── 14. WELCOME MODAL ─────────────────────────────────────────────────────

import { APP_VERSION, FOCUS_DELAY_MS } from './config.js';
import { state, setState } from './state.js';
import { loadFromGist } from './gist.js';
import { showToast } from './notify.js';
import { refreshAllMarkerStates } from './markers.js';
import { renderAllRideOverlays } from './rides.js';
import { updateSessionUI } from './session.js';

const setupFocusTrap = (modalEl, overlayEl) => {
    modalEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            overlayEl.classList.add('hidden');
            document.getElementById('stationSearch')?.focus();   // return focus somewhere sensible
            return;
        }
        if (e.key !== 'Tab') return;
        const items = [...modalEl.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')];
        const [first, last] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
};

export const setupModal = (map) => {
    const overlay = document.getElementById('name-modal-overlay');
    const modal   = document.getElementById('name-modal');
    const input   = document.getElementById('modal-name-input');

    const ver = document.getElementById('app-version');
    if (ver) ver.textContent = APP_VERSION;
    setupFocusTrap(modal, overlay);

    if (!state.user) {
        overlay.classList.remove('hidden');
        setTimeout(() => input.focus(), FOCUS_DELAY_MS);
    }

    const confirmModal = async () => {
        const name = input.value.trim();
        overlay.classList.add('hidden');
        if (!name) return;
        setState('user', name);
        updateSessionUI();
        // The modal only shows for anonymous users — merge any progress they
        // already collected rather than wiping it with the loaded gist.
        await loadFromGist(name, { mergeLocal: true });
        refreshAllMarkerStates();
        renderAllRideOverlays();
        showToast(`Welcome, ${name}!`);
    };

    document.getElementById('modal-confirm').addEventListener('click', confirmModal);
    document.getElementById('modal-skip').addEventListener('click', () => overlay.classList.add('hidden'));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmModal(); });
};
