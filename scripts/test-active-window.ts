/**
 * Unit tests for the active-window math in `lib/billing.ts` (M4.9).
 *
 * Covers the contract that the on-chain settle amount and the buyer's
 * displayed ticker BOTH derive from `computeBillableWindow` /
 * `activeWindowDurationSec`. If either function drifts, the demo's
 * "settle for what you used" pitch breaks — these tests are the safety
 * net. They are pure-function tests; no Daily, no DDB, no network.
 *
 * Run with: pnpm test
 *
 * Uses Node 22+ built-in test runner (`node:test`) executed under tsx
 * for TypeScript source compatibility. No jest, no vitest, no extra
 * runtime deps — keeps the hackathon dep tree minimal.
 *
 * The 6 cases mirror Phase 8's spec:
 *   1. Empty event log               → window never opens
 *   2. Single participant only       → window never opens
 *   3. Two participants, normal flow → window opens at 2nd join,
 *                                      closes at 1st leave
 *   4. Out-of-order (race) delivery  → result is order-independent
 *   5. Three participants            → 1st pair opens, 1st leave
 *                                      below 2 closes
 *   6. Settle amount cap             → durationSec × rate clamps at
 *                                      M2_UPTO_MAX_ATOMIC ($5)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeBillableWindow,
  activeWindowDurationSec,
  type ParticipantEvent,
} from '../lib/billing';
import { computeSettleAmount, M2_UPTO_MAX_ATOMIC } from '../lib/constants';

// ─── Case 1: empty events ───
test('empty events → window never opens', () => {
  const result = computeBillableWindow([]);
  assert.equal(result.start_ms, undefined);
  assert.equal(result.end_ms, undefined);
  assert.equal(activeWindowDurationSec([]), 0);
});

// ─── Case 2: single participant only ───
test('single participant only → window never opens', () => {
  const events: ParticipantEvent[] = [
    { type: 'joined', participant_id: 'buyer', timestamp_ms: 1_000_000 },
  ];
  const result = computeBillableWindow(events);
  assert.equal(result.start_ms, undefined, 'start_ms should be undefined with only 1 participant');
  assert.equal(result.end_ms, undefined);
  assert.equal(activeWindowDurationSec(events), 0);
});

// ─── Case 3: two participants, normal flow ───
test('two participants normal flow → window opens at 2nd join, closes at 1st leave', () => {
  const events: ParticipantEvent[] = [
    { type: 'joined', participant_id: 'buyer', timestamp_ms: 1_000_000 },
    { type: 'joined', participant_id: 'expert', timestamp_ms: 1_005_000 }, // +5s
    { type: 'left', participant_id: 'expert', timestamp_ms: 1_035_000 }, //  +30s after open
    { type: 'left', participant_id: 'buyer', timestamp_ms: 1_040_000 },
  ];
  const result = computeBillableWindow(events);
  assert.equal(result.start_ms, 1_005_000, 'window opens at expert join (count went 1→2)');
  assert.equal(result.end_ms, 1_035_000, 'window closes at expert leave (count went 2→1)');
  assert.equal(
    activeWindowDurationSec(events),
    30,
    'duration = (end - start) / 1000 = 30s — buyer waiting time before expert joined is NOT billed',
  );
});

// ─── Case 4: out-of-order webhook delivery ───
test('out-of-order events → identical result (delivery order independence)', () => {
  // Same events as Case 3 but reverse-shuffled. Daily's webhooks are
  // at-least-once and not strictly ordered, so the math must sort
  // internally. If this case diverges from Case 3, the function isn't
  // commutative and on-chain settle could disagree with the ticker.
  const shuffled: ParticipantEvent[] = [
    { type: 'left', participant_id: 'buyer', timestamp_ms: 1_040_000 },
    { type: 'joined', participant_id: 'expert', timestamp_ms: 1_005_000 },
    { type: 'left', participant_id: 'expert', timestamp_ms: 1_035_000 },
    { type: 'joined', participant_id: 'buyer', timestamp_ms: 1_000_000 },
  ];
  const result = computeBillableWindow(shuffled);
  assert.equal(result.start_ms, 1_005_000);
  assert.equal(result.end_ms, 1_035_000);
  assert.equal(activeWindowDurationSec(shuffled), 30);
});

// ─── Case 5: three participants ───
test('three participants → 2nd join opens, 1st leave below count-2 closes', () => {
  // max_participants is 2 in production, but the math should still
  // be correct if Daily ever sent us a 3-participant scenario (e.g.,
  // a future host-mode where an admin observes). The window opens
  // when the count first reaches 2, NOT 3 — and closes the first
  // time the count drops below 2.
  const events: ParticipantEvent[] = [
    { type: 'joined', participant_id: 'a', timestamp_ms: 0 },
    { type: 'joined', participant_id: 'b', timestamp_ms: 1_000 }, //  count→2, opens
    { type: 'joined', participant_id: 'c', timestamp_ms: 2_000 }, //  count→3, no-op
    { type: 'left', participant_id: 'c', timestamp_ms: 5_000 }, //  count→2, no-op
    { type: 'left', participant_id: 'b', timestamp_ms: 8_000 }, //  count→1, closes
    { type: 'left', participant_id: 'a', timestamp_ms: 10_000 }, // count→0, no-op
  ];
  const result = computeBillableWindow(events);
  assert.equal(result.start_ms, 1_000, 'opens at B join (count 1→2), not C join (2→3)');
  assert.equal(result.end_ms, 8_000, 'closes at B leave (count 2→1), not C leave (3→2)');
  assert.equal(activeWindowDurationSec(events), 7); // (8000 - 1000) / 1000 = 7
});

// ─── Case 6: settle amount caps at M2_UPTO_MAX_ATOMIC ($5) ───
test('settle amount cap → duration × rate clamps at the upto MAX', () => {
  // The buyer's authorization is for up to $5. If the active window
  // somehow exceeds 500 seconds (× $0.01/s = $5.00), the on-chain
  // settle must clamp — anything above would violate the signed
  // permit and the facilitator would reject.
  // 499s → $4.99 (under cap, raw value)
  assert.equal(computeSettleAmount(499), 4_990_000n);
  // 500s → $5.00 (exactly at cap)
  assert.equal(computeSettleAmount(500), M2_UPTO_MAX_ATOMIC);
  // 600s → still $5.00 (clamped)
  assert.equal(computeSettleAmount(600), M2_UPTO_MAX_ATOMIC);
  // 100_000s → still $5.00 (clamped, no overflow at large input)
  assert.equal(computeSettleAmount(100_000), M2_UPTO_MAX_ATOMIC);
});

// ─── Bonus: idempotency under duplicate webhook delivery ───
test('idempotent under duplicate events (Daily at-least-once)', () => {
  // The Set-replay strategy means re-applying the same join event
  // is a no-op. Verifies the safety net for Daily's at-least-once
  // webhook delivery — duplicates DON'T inflate the duration.
  const dup: ParticipantEvent[] = [
    { type: 'joined', participant_id: 'buyer', timestamp_ms: 1_000_000 },
    { type: 'joined', participant_id: 'buyer', timestamp_ms: 1_000_000 }, // duplicate
    { type: 'joined', participant_id: 'expert', timestamp_ms: 1_005_000 },
    { type: 'joined', participant_id: 'expert', timestamp_ms: 1_005_000 }, // duplicate
    { type: 'left', participant_id: 'expert', timestamp_ms: 1_035_000 },
    { type: 'left', participant_id: 'buyer', timestamp_ms: 1_040_000 },
  ];
  const result = computeBillableWindow(dup);
  assert.equal(result.start_ms, 1_005_000, "duplicate joined doesn't bump start_ms");
  assert.equal(result.end_ms, 1_035_000);
  assert.equal(activeWindowDurationSec(dup), 30);
});

// ─── Bonus: in-progress call (window opened but not closed yet) ───
test('window opened but not closed → uses nowMs as running end', () => {
  // Drives the buyer's live ticker: the window is open (both parties
  // joined), but neither has left yet. activeWindowDurationSec uses
  // the supplied nowMs to give the current running duration.
  const events: ParticipantEvent[] = [
    { type: 'joined', participant_id: 'buyer', timestamp_ms: 1_000_000 },
    { type: 'joined', participant_id: 'expert', timestamp_ms: 1_005_000 },
    // No leaves — call still in progress
  ];
  const result = computeBillableWindow(events);
  assert.equal(result.start_ms, 1_005_000);
  assert.equal(result.end_ms, undefined, 'end_ms is undefined while in progress');
  // Pretend "now" is 60s after the window opened.
  assert.equal(activeWindowDurationSec(events, 1_065_000), 60);
});
