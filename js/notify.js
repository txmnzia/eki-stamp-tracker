// ── 5. NOTIFICATIONS ──────────────────────────────────────────────────────
// Runtime-only cycle with cloud.js (see cloud.js header).

import { syncNow } from './cloud.js';

let toastTimer;
// kind: '' (neutral) or 'error' — failures must LOOK different from successes
// (docs/AUDIT.md F-11), not just read differently.
export const showToast = (msg, duration = 2400, kind = '') => {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('toast--error', kind === 'error');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
};

export const setSyncStatus = (status, err) => {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.className = 'sync-status ' + status;
    if (status === 'error') {
        // Say what happened AND what to do — a bare "sync error" is not
        // actionable (docs/AUDIT.md F-10). err.status is fetch's numeric
        // Response.status (coerced, so nothing external reaches innerHTML).
        const code   = Number(err?.status) || 0;
        const reason = (code === 401 || code === 403) ? '✗ signed out — sign in again'
                     : code                           ? `✗ sync failed (HTTP ${code})`
                     :                                  '✗ offline? sync failed';
        el.innerHTML = `${reason} · <a href="#" class="sync-retry-link">retry</a>`;
        el.querySelector('.sync-retry-link')?.addEventListener('click', (e) => { e.preventDefault(); syncNow(); });
    } else {
        el.textContent = { saving: '↑ saving…', saved: '✓ synced',
                           local: 'saved on this device · sign in to sync', '': '' }[status] ?? '';
    }
};

export const hideLoading = () => {
    const el = document.getElementById('loading-overlay');
    if (!el) return;
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 400);
};
