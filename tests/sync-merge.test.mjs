// Unit tests for js/sync-merge.js — the pure merge behind Supabase sync.
// Run with:  node --test tests/*.test.mjs
//
// Behavioural anchors: local progress is never lost on first sign-in, and an
// edit on one device never clobbers another device's edits (the gist's
// full-replace sync did).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toItems, fromRideItems, merge3, minus, sameSet, rideItem, splitRideItem } from '../js/sync-merge.js';

const S = (...a) => new Set(a);

test('first sign-in (empty base) is a union: local progress survives', () => {
  assert.deepEqual(merge3(S('a', 'b'), S('b', 'c'), S()), S('a', 'b', 'c'));
});

test('local removal since base propagates; remote additions survive', () => {
  // base {a,b}; this device removed b and added c; another device added d
  assert.deepEqual(merge3(S('a', 'b', 'd'), S('a', 'c'), S('a', 'b')), S('a', 'c', 'd'));
});

test('remote removal survives when this device did not touch the item', () => {
  // another device removed b; this device still has b from base
  assert.deepEqual(merge3(S('a'), S('a', 'b'), S('a', 'b')), S('a'));
});

test('reset (local emptied) removes everything this device had synced', () => {
  assert.deepEqual(merge3(S('a', 'b', 'x'), S(), S('a', 'b')), S('x'));
});

test('ride items round-trip, including legacy station-code values', () => {
  const rides = { 'JR山手線': ['eki_1|eki_2', 'eki_2|eki_3'], 'いすみ線': ['eki_9'] };
  const it = toItems(['eki_1'], rides);
  assert.ok(it.rides.has(rideItem('JR山手線', 'eki_1|eki_2')));
  assert.deepEqual(splitRideItem(rideItem('いすみ線', 'eki_9')), ['いすみ線', 'eki_9']);
  assert.deepEqual(fromRideItems(it.rides), rides);
  assert.deepEqual(it.stamps, S('eki_1'));
});

test('minus and sameSet', () => {
  assert.deepEqual(minus(S('a', 'b'), S('b')), ['a']);
  assert.ok(sameSet(S('a', 'b'), S('b', 'a')));
  assert.ok(!sameSet(S('a'), S('a', 'b')));
});
