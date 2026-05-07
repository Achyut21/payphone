/**
 * GET /api/sessions/[id]/status — poll endpoint for the live session page.
 *
 * The session page polls this every 2 seconds (see Phase 4) to learn when
 * the meeting has ended and the on-chain settle has landed; on
 * `status === 'COMPLETED'` it navigates to the recap page.
 *
 * 404 on unknown ids is the right answer here — clients shouldn't poll
 * indefinitely on a typoed path. The marketplace's startSession action
 * redirects to a real id, so 404 only happens with hand-typed URLs.
 *
 * Auth: M5 ownership gate via `requireSessionOwner`. A non-owner gets
 * the same 404 as a missing session — we don't leak existence. This
 * also means a non-owner can't trigger the lazy 90s timeout transition
 * below on someone else's session.
 *
 * `runtime = 'nodejs'` because `lib/db.ts` uses the AWS SDK (Node-only).
 *
 * Note: Next 16 makes route-segment params async (`Promise<{ id }>`).
 * Awaiting the proxy is required; reading `.id` synchronously throws
 * a DynamicAPIError at runtime.
 *
 * M4.9: lazy 90s no-expert-joined timeout. Implemented here (rather
 * than as a background job) because the session page is already
 * polling at 2s — the timeout fires on the next poll after the
 * threshold passes. No additional infra needed.
 */

import { NextResponse } from 'next/server';

import { getSession, markSessionTimedOut, type SessionRow } from '@/lib/db';
import { requireSessionOwner } from '@/lib/session-auth';

export const runtime = 'nodejs';

/**
 * 90 seconds. Past this without the second participant joining, the
 * session transitions to TIMEOUT and the buyer is bounced to a
 * "no expert showed up" page. The Permit2 authorization simply
 * expires at its on-chain deadline (30 min); zero USDC moves.
 */
const NO_EXPERT_TIMEOUT_MS = 90_000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id || id.length === 0) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  const guard = await requireSessionOwner(id);
  if (!guard.ok) return guard.response;
  let session: SessionRow = guard.row;

  // M4.9: lazy timeout transition. If the session has been waiting for
  // the second participant to join for >90s, flip it to TIMEOUT. The
  // DDB helper is conditional on (status=AUTHORIZED AND no window
  // start), so this is a no-op if the call has actually started.
  //
  // Why lazy-on-poll: the buyer's session page is already polling at
  // 2s, so the timeout fires within ~2s of the threshold passing. No
  // background job, no scheduled lambda, no new infrastructure. Trade-
  // off: if the user closes the tab during the wait, the row stays
  // AUTHORIZED until the next time SOMEONE polls the same session id
  // — but no one will, so it just sits in AUTHORIZED forever. That's
  // fine; the row's `expires_at` TTL (24h) cleans it up eventually
  // and no on-chain effect is lost.
  if (session.status === 'AUTHORIZED' && session.billable_window_start_ms === undefined) {
    // Prefer ms-precision started_at_ms (M4.9 rows). Fall back to
    // started_at * 1000 for older rows that pre-date this milestone.
    const startedAtMs = session.started_at_ms ?? session.started_at * 1000;
    if (Date.now() - startedAtMs > NO_EXPERT_TIMEOUT_MS) {
      await markSessionTimedOut(session.session_id);
      // Re-fetch so the response reflects the new status. Cheaper to
      // shallow-mutate the in-memory copy, but a re-fetch makes the
      // contract obvious and is one DDB GET.
      session = (await getSession(id)) ?? session;
    }
  }

  // Surface the status-relevant fields. Settle-only fields are nullable
  // until the meeting.ended webhook has fired; clients use their absence
  // to keep polling.
  //
  // M4.9: also expose `billable_window_start_ms` and `billable_window_end_ms`
  // so the client can drive the ticker off the active-window boundaries
  // (waiting state when start is null, frozen at end when set).
  return jsonResponse(session);
}

function jsonResponse(session: SessionRow): NextResponse {
  return NextResponse.json({
    sessionId: session.session_id,
    status: session.status,
    started_at: session.started_at,
    ended_at: session.ended_at ?? null,
    duration_sec: session.duration_sec ?? null,
    settled_amount: session.settled_amount ?? null,
    settle_tx_hash: session.settle_tx_hash ?? null,
    max_authorized_amount: session.max_authorized_amount,
    billable_window_start_ms: session.billable_window_start_ms ?? null,
    billable_window_end_ms: session.billable_window_end_ms ?? null,
  });
}
