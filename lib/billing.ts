/**
 * PayPhone — active-window billing math (M4.9).
 *
 * The "active window" is the contiguous time interval during which the
 * call had >= 2 participants in the room. It begins the first instant
 * the participant count reaches 2 (a conversation can start) and ends
 * the first instant the count drops back below 2 (the conversation can
 * no longer continue).
 *
 * This is the duration we settle for on-chain. Two architectural goals:
 *
 *   1. Don't bill the buyer for "waiting for the expert to join" time
 *      between session creation and the second participant joining.
 *
 *   2. Don't bill the buyer for "after the other party left" time. If
 *      the expert hangs up at t=60s but the buyer sits on the page
 *      until t=120s, we settle for 60 — not 120. On-chain settle and
 *      UI ticker must agree, otherwise BaseScan exposes the divergence.
 *
 * Implementation: append-only event log (joined / left + timestamps +
 * participant ids). We replay events into a Set keyed by participant_id
 * to compute the current count. This is robust to Daily's at-least-once
 * webhook delivery (duplicates are no-ops on Set) and to occasional
 * out-of-order delivery (sort by timestamp first).
 *
 * Pure functions, no side effects — easy to unit-test in
 * scripts/test-active-window.ts.
 */

/** A single participant lifecycle event captured from a Daily webhook. */
export type ParticipantEvent = {
  type: 'joined' | 'left';
  /** Daily's per-session participant id; stable across the call. */
  participant_id: string;
  /** Wall-clock millis when the event happened (Daily server clock). */
  timestamp_ms: number;
};

/**
 * Compute the billable window's start/end timestamps from an event log.
 *
 * Returns { start_ms, end_ms } where either may be undefined:
 *
 *   - start_ms === undefined: count never reached 2. Either still
 *     waiting for the expert, or the call ended in a no-show.
 *   - end_ms === undefined (with start_ms set): window opened but
 *     hasn't closed yet — call still in progress.
 *
 * Idempotent + commutative under timestamp-sort: feeding the same set
 * of events in any order produces the same result. Safe under Daily's
 * at-least-once webhook delivery (duplicate events are no-ops because
 * Set.add of an existing key is a no-op).
 *
 * "First time" semantics: if a call goes 2 -> 1 -> 2 -> 1, we lock
 * end_ms on the first 2->1 transition. Subsequent re-handshakes don't
 * extend the window. Doesn't happen at hackathon scale (max_participants
 * = 2, no rejoin pattern), but the deterministic behavior matters.
 */
export function computeBillableWindow(events: ParticipantEvent[]): {
  start_ms?: number;
  end_ms?: number;
} {
  // Sort ascending by timestamp. Stable sort preserves input order on
  // ties; ties only happen on duplicate deliveries which Set.add makes
  // a no-op anyway, so order doesn't matter for correctness.
  const sorted = [...events].sort((a, b) => a.timestamp_ms - b.timestamp_ms);

  const inRoom = new Set<string>();
  let start_ms: number | undefined;
  let end_ms: number | undefined;

  for (const e of sorted) {
    const wasCount = inRoom.size;
    if (e.type === 'joined') {
      inRoom.add(e.participant_id);
    } else {
      inRoom.delete(e.participant_id);
    }
    const newCount = inRoom.size;

    // Window OPENS the first instant we transition from <2 to >=2.
    if (wasCount < 2 && newCount >= 2 && start_ms === undefined) {
      start_ms = e.timestamp_ms;
    }
    // Window CLOSES the first instant we transition from >=2 to <2,
    // but only if it ever opened. Locked once set.
    if (wasCount >= 2 && newCount < 2 && start_ms !== undefined && end_ms === undefined) {
      end_ms = e.timestamp_ms;
    }
  }

  return { start_ms, end_ms };
}

/**
 * Compute the active-window duration in whole seconds.
 *
 * - Returns 0 if window never opened.
 * - If window opened but never closed, uses nowMs as running end so
 *   callers can drive a live ticker.
 * - Floors to whole seconds — same convention as computeSettleAmount
 *   in lib/constants.ts. Display and on-chain settle agree.
 * - Negative durations (clock skew) clamp to 0 defensively.
 */
export function activeWindowDurationSec(
  events: ParticipantEvent[],
  nowMs: number = Date.now(),
): number {
  const { start_ms, end_ms } = computeBillableWindow(events);
  if (start_ms === undefined) return 0;
  const effective_end = end_ms ?? nowMs;
  return Math.max(0, Math.floor((effective_end - start_ms) / 1000));
}
