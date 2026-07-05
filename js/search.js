// ── 10. SEARCH ────────────────────────────────────────────────────────────

import { MAX_SUGGESTIONS, SEARCH_JUMP_MS } from './config.js';
import { state } from './state.js';
import { ui, markers } from './registry.js';
import { rankCandidates } from './search-rank.js';

/**
 * Render search suggestions for the current input value and language.
 * Called on input change AND on language toggle (if input has text).
 */
export const renderSuggestions = (map, term) => {
    const box   = document.getElementById('suggestions');
    const input = document.getElementById('stationSearch');
    box.innerHTML = '';
    box.style.display = 'none';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (!term) return;

    // Rank by relevance (prefix > word-start > substring — docs/AUDIT.md F-1),
    // then by distance from the current map view so equally-relevant results
    // favour where the user is looking; line count breaks remaining ties.
    const ctr  = map.getCenter();
    const hits = rankCandidates(term, markers.map(m => ({
        m, en: m.stationNameEN, jp: m.stationNameJP,
        dist: ctr.distanceTo(m.getLatLng()), weight: m._lineCodes.length,
    }))).slice(0, MAX_SUGGESTIONS).map(c => c.m);

    if (!hits.length) return;
    box.style.display = 'block';
    input.setAttribute('aria-expanded', 'true');

    hits.forEach((m, i) => {
        const primary   = state.lang === 'jp' ? (m.stationNameJP || m.stationNameEN) : (m.stationNameEN || m.stationNameJP);
        const secondary = state.lang === 'jp' ? m.stationNameEN : m.stationNameJP;

        const item = document.createElement('div');
        item.className   = 'suggestion-item';
        item.id          = 'sug-' + i;
        item.setAttribute('role', 'option');

        const nameDiv = document.createElement('div');
        const p = document.createElement('div');
        p.className = 'sug-primary'; p.textContent = primary;
        nameDiv.appendChild(p);
        if (secondary) {
            const s = document.createElement('div');
            s.className = 'sug-secondary'; s.textContent = secondary;
            nameDiv.appendChild(s);
        }
        item.appendChild(nameDiv);

        if (m._isCollected) {
            const badge = document.createElement('span');
            badge.className = 'collected-badge'; badge.textContent = '✓';
            item.appendChild(badge);
        }

        item.addEventListener('click', () => {
            map.setView(m.getLatLng(), 15);
            // Set ui.currentPopupMarker BEFORE openPopup so the collect
            // button's event-delegation handler can find the marker.
            ui.currentPopupMarker = m;
            setTimeout(() => m.openPopup(), SEARCH_JUMP_MS);
            box.style.display = 'none';
            document.getElementById('stationSearch').value = '';
        });

        box.appendChild(item);
    });
};

export const setupSearch = (map) => {
    const input = document.getElementById('stationSearch');
    const box   = document.getElementById('suggestions');
    let activeIdx = -1;
    const setActive = (items, idx) => {
        activeIdx = idx;
        items.forEach((it, i) => it.classList.toggle('active', i === idx));
        if (idx >= 0) input.setAttribute('aria-activedescendant', items[idx].id);
        else input.removeAttribute('aria-activedescendant');
    };
    input.addEventListener('input', () => { activeIdx = -1; renderSuggestions(map, input.value.trim()); });
    // Keyboard access to the suggestion list (it's mouse/touch-only otherwise).
    input.addEventListener('keydown', (e) => {
        const items = [...box.querySelectorAll('.suggestion-item')];
        if (!items.length || box.style.display === 'none') return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(items, (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
        } else if (e.key === 'Enter' && activeIdx >= 0) {
            e.preventDefault();
            items[activeIdx].click();
            setActive(items, -1);
        } else if (e.key === 'Escape') {
            box.style.display = 'none';
            input.setAttribute('aria-expanded', 'false');
            setActive(items, -1);
        }
    });
    document.addEventListener('click', e => {
        if (!e.target.closest('#search-container'))
            document.getElementById('suggestions').style.display = 'none';
    });
};
