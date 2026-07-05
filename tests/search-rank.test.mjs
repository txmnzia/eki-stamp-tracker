// Unit tests for js/search-rank.js — the pure search-relevance layer.
// Run with:  node --test tests/*.test.mjs
//
// Behavioural anchor for docs/AUDIT.md F-1: prefix matches beat word-start
// matches beat substring matches; line count (weight) then name length break
// ties, so major stations surface before same-prefix minor ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchScore, rankCandidates } from '../js/search-rank.js';

test('matchScore: prefix 0, word-start 1, mid-word 2, miss -1', () => {
  assert.equal(matchScore('shinjuku', 'shin'), 0);
  assert.equal(matchScore('shin-osaka', 'osaka'), 1);      // after hyphen
  assert.equal(matchScore('universal city', 'city'), 1);   // after space
  assert.equal(matchScore('nishi-shinjuku', 'shin'), 1);   // compound word start
  assert.equal(matchScore('hoshino', 'shin'), 2);          // buried mid-word
  assert.equal(matchScore('tokyo', 'shin'), -1);
});

test('rank: prefix beats word-start beats substring, regardless of input order', () => {
  const cands = [
    { en: 'Hoshino',        jp: '',     weight: 1 },  // substring
    { en: 'Nishi-Shinjuku', jp: '',     weight: 1 },  // word start
    { en: 'Shintoku',       jp: '',     weight: 1 },  // prefix
  ];
  const out = rankCandidates('shin', cands).map(c => c.en);
  assert.deepEqual(out, ['Shintoku', 'Nishi-Shinjuku', 'Hoshino']);
});

test('rank: within the same score, closer to the map view wins — even over weight', () => {
  const cands = [
    { en: 'Shinjuku',  jp: '', dist: 400_000, weight: 11 },  // major but far
    { en: 'Shin-Osaka', jp: '', dist: 2_000,  weight: 3 },   // minor-er but here
  ];
  assert.equal(rankCandidates('shin', cands)[0].en, 'Shin-Osaka');
  // …but a better relevance score still beats proximity:
  const scored = [
    { en: 'Hoshino',  jp: '', dist: 100,     weight: 1 },   // substring, adjacent
    { en: 'Shintoku', jp: '', dist: 900_000, weight: 1 },   // prefix, far away
  ];
  assert.equal(rankCandidates('shin', scored)[0].en, 'Shintoku');
});

test('rank: missing dist sorts after known dist within a score, and never throws', () => {
  const cands = [
    { en: 'Shinkawa', jp: '', weight: 1 },              // no dist
    { en: 'Shintoku', jp: '', dist: 50_000, weight: 1 },
  ];
  assert.equal(rankCandidates('shin', cands)[0].en, 'Shintoku');
});

test('rank: weight (line count) breaks ties when distance cannot', () => {
  const cands = [
    { en: 'Shintoku', jp: '', weight: 1 },   // same prefix score, minor station
    { en: 'Shinjuku', jp: '', weight: 11 },  // major interchange
  ];
  assert.equal(rankCandidates('shin', cands)[0].en, 'Shinjuku');
});

test('rank: shorter name wins when score and weight tie', () => {
  const cands = [
    { en: 'Shinjuku-gyoemmae', jp: '', weight: 2 },
    { en: 'Shinjuku',          jp: '', weight: 2 },
  ];
  assert.equal(rankCandidates('shinju', cands)[0].en, 'Shinjuku');
});

test('rank: matches Japanese names too, and takes the better of the two scores', () => {
  const cands = [
    { en: 'Yotsuya',  jp: '四ツ谷', weight: 3 },
    { en: 'Ichigaya', jp: '市ケ谷', weight: 2 },
  ];
  assert.equal(rankCandidates('四ツ', cands).length, 1);
  assert.equal(rankCandidates('四ツ', cands)[0].en, 'Yotsuya');
  // EN prefix on one, JP substring on the other → EN prefix first.
  const mixed = rankCandidates('ichi', cands);
  assert.equal(mixed[0].en, 'Ichigaya');
});

test('rank: empty term and non-matches return empty; missing fields are safe', () => {
  assert.deepEqual(rankCandidates('', [{ en: 'Tokyo', jp: '東京', weight: 1 }]), []);
  assert.deepEqual(rankCandidates('zz', [{ en: 'Tokyo', jp: '東京', weight: 1 }]), []);
  assert.equal(rankCandidates('tok', [{ en: 'Tokyo' }]).length, 1);
});
