// ── 11. LANGUAGE ──────────────────────────────────────────────────────────

import { state, setState } from './state.js';
import { ui, markers, plainMarkers } from './registry.js';
import { getDisplayName } from './markers.js';
import { renderSuggestions } from './search.js';

const updateLangBtn = () => {
    const btn   = document.getElementById('lang-toggle');
    const label = state.lang === 'jp' ? '日本語' : 'EN';
    const tip   = state.lang === 'jp' ? 'Switch to English' : 'Switch to Japanese (日本語)';
    btn.textContent = label;
    btn.title       = tip;
    btn.setAttribute('aria-label', tip);
};

export const setupLanguageToggle = (map) => {
    updateLangBtn();
    document.getElementById('lang-toggle').addEventListener('click', () => {
        setState('lang', state.lang === 'en' ? 'jp' : 'en');
        updateLangBtn();

        // Update lang attribute on <html> for screen readers
        document.documentElement.lang = state.lang === 'jp' ? 'ja' : 'en';

        // (The toggle switches NAMES only — UI chrome stays English, so no
        //  lone translated string like the old modal title.)

        // Refresh cached marker display names. Popup content is a function
        // (rebuilt on open) so it picks up the new language automatically; only
        // the popup that's already open needs a nudge to redraw now.
        [...markers, ...plainMarkers].forEach(m => {
            if (!m._stationData) return;
            m.stationName = getDisplayName(m._stationData, m._stationData.code);
        });
        if (ui.currentPopupMarker?.isPopupOpen?.()) ui.currentPopupMarker.openPopup();

        // Re-render visible search suggestions in new language
        const term = document.getElementById('stationSearch').value.trim();
        renderSuggestions(map, term);
    });
};
