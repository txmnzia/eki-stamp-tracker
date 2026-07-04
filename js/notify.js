// ── 5. NOTIFICATIONS ──────────────────────────────────────────────────────
// Runtime-only cycle with gist.js (see gist.js header).

import { syncToGist } from './gist.js';

let toastTimer;
export const showToast = (msg, duration = 2400) => {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
};

export const setSyncStatus = (status) => {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.className = 'sync-status ' + status;
    if (status === 'error') {
        el.innerHTML = '✗ sync error · <a href="#" class="sync-retry-link">retry</a>';
        el.querySelector('.sync-retry-link')?.addEventListener('click', (e) => { e.preventDefault(); syncToGist(); });
    } else {
        el.textContent = { saving: '↑ saving…', saved: '✓ synced',
                           local: 'saved on this device · add a token to sync', '': '' }[status] ?? '';
    }
};

export const hideLoading = () => {
    const el = document.getElementById('loading-overlay');
    if (!el) return;
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 400);
};
