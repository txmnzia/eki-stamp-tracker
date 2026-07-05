// ── 10b. SEARCH RANKING (pure) ────────────────────────────────────────────
// Relevance ranking for station search. Pure functions (no DOM, no Leaflet,
// no app state) so they are unit-testable via node --test, like geometry.js.
// Before this existed, suggestions were served in station-array order
// (roughly north→south), so "shin" listed six Hokkaido stations and never
// Shinjuku (docs/AUDIT.md F-1).

// How well `name` matches `term` (both already lowercased):
//   0 = name starts with the term
//   1 = a word inside the name starts with the term (after a space, hyphen,
//       dot or bracket — covers "Shin-Osaka", "Universal City", "本郷(春日)")
//   2 = the term appears mid-word
//  -1 = no match
export const matchScore = (name, term) => {
    const i = name.indexOf(term);
    if (i < 0) return -1;
    if (i === 0) return 0;
    return /[\s\-‐－・.((]/.test(name[i - 1]) ? 1 : 2;
};

/**
 * Rank search candidates by relevance, then proximity.
 * @param {string} term  search input (any case)
 * @param {Array}  cands [{ en, jp, dist, weight }] —
 *   `dist`   optional distance in metres from the user's current map view;
 *            within the same relevance score, closer stations come first
 *            (searching "shin" while looking at Osaka should offer
 *            Shin-Osaka before Shinjuku);
 *   `weight` breaks remaining ties (the app passes the station's line
 *            count: interchanges outrank halts when distance can't decide).
 * @returns the matching candidates, best first (caller slices to taste)
 */
export const rankCandidates = (term, cands) => {
    const t = term.toLowerCase();
    if (!t) return [];
    return cands
        .map(c => {
            const en = (c.en || '').toLowerCase();
            const jp = (c.jp || '').toLowerCase();
            const se = matchScore(en, t), sj = matchScore(jp, t);
            // Best score across languages; length of the matched name is the
            // final tie-break so "Shinjuku" beats "Shinjuku-gyoemmae".
            const score = (se < 0) ? sj : (sj < 0) ? se : Math.min(se, sj);
            const len   = (se >= 0 && (sj < 0 || se <= sj)) ? en.length : jp.length;
            return { c, score, len };
        })
        .filter(r => r.score >= 0)
        .sort((a, b) =>
            a.score - b.score ||
            (Number.isFinite(a.c.dist) ? a.c.dist : Infinity)
              - (Number.isFinite(b.c.dist) ? b.c.dist : Infinity) ||
            (b.c.weight || 0) - (a.c.weight || 0) ||
            a.len - b.len ||
            String(a.c.en).localeCompare(String(b.c.en)))
        .map(r => r.c);
};
