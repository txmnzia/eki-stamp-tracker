// ── 12. STATS ─────────────────────────────────────────────────────────────

import { state } from './state.js';
import { markers } from './registry.js';

export const updateStats = () => {
    const done  = state.stamps.size;
    const total = markers.length;
    const pct   = total > 0 ? (done / total) * 100 : 0;

    document.getElementById('session-count').textContent = `${done.toLocaleString()} / ${total.toLocaleString()} collected`;
    document.getElementById('bar-count').textContent     = done.toLocaleString();

    const barTotal = document.getElementById('bar-total');
    if (barTotal) barTotal.textContent = total ? ` / ${total.toLocaleString()}` : '';

    const hint = document.getElementById('stats-hint');
    if (hint) hint.classList.toggle('hidden', done > 0 || total === 0);

    const fill = document.getElementById('session-progress-fill');
    if (fill) fill.style.width = pct + '%';
    const bar  = document.getElementById('session-progress-bar');
    if (bar)  bar.setAttribute('aria-valuenow', Math.round(pct));
};
