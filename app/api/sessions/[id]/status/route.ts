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
 * `runtime = 'nodejs'` because `lib/db.ts` uses the AWS SDK (Node-only).
 *
 * Note: Next 16 makes route-segment params async (`Promise<{ id }>`).
 * Awaiting the proxy is required; reading `.id` synchronously throws
 * a DynamicAPIError at runtime.
 */

import { NextResponse } from 'next/server';

import { getSession } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id || id.length === 0) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Surface the status-relevant fields. Settle-only fields are nullable
  // until the meeting.ended webhook has fired; clients use their absence
  // to keep polling.
  return NextResponse.json({
    sessionId: session.session_id,
    status: session.status,
    started_at: session.started_at,
    ended_at: session.ended_at ?? null,
    duration_sec: session.duration_sec ?? null,
    settled_amount: session.settled_amount ?? null,
    settle_tx_hash: session.settle_tx_hash ?? null,
    max_authorized_amount: session.max_authorized_amount,
  });
}
