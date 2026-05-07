/**
 * POST /api/webhooks/daily — Daily.co webhook receiver.
 *
 * Three event types drive PayPhone's billing lifecycle (M4.9):
 *
 *   - `participant.joined` — append to event log, recompute active
 *     window. If the window just opened (count first reached 2),
 *     transition AUTHORIZED -> ACTIVE and lock billable_window_start_ms.
 *
 *   - `participant.left` — append to event log, recompute active window.
 *     If the window just closed (count first dropped below 2), lock
 *     billable_window_end_ms and FIRE THE SETTLE. This is the M4.9
 *     architectural fix: previously settle waited for `meeting.ended`,
 *     which only fires when the room is fully empty, so a buyer who sat
 *     on the page after the expert left would delay their own settle.
 *     Now settle fires the instant the second-to-last participant leaves.
 *
 *   - `meeting.ended` — fallback only. By the time it fires, settle has
 *     already fired from participant.left in the happy path. Idempotent
 *     via markSessionCompleted's ConditionExpression — the second
 *     write to a COMPLETED row is a no-op.
 *
 * Architectural note: CONTEXT.md describes "AWS Lambda for the Daily.co
 * webhook receiver" as a separate service. M3 consolidates this into a
 * Next.js API route — when deployed to AWS Amplify in M5, this route
 * runs as a Lambda automatically. Same compute model, less plumbing.
 *
 * Daily's retry policy: 3 failures -> circuit breaks -> no further
 * deliveries until manual re-activate. 200 responses reset the failure
 * counter. So we lean toward 200 for any "we got it, stop retrying"
 * outcome (including already-settled), and 5xx only for genuine
 * transient failures we want Daily to retry.
 *
 * `runtime = 'nodejs'` — uses node:crypto, AWS SDK, CDP SDK.
 */

import { NextResponse } from 'next/server';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';

import {
  ACTIVE_CAIP2,
  ACTIVE_CDP_FACILITATOR_ADDRESS,
  ACTIVE_USDC_ADDRESS,
  ACTIVE_USDC_DOMAIN,
  M2_UPTO_MAX_ATOMIC,
  M3_PER_SECOND_RATE_ATOMIC,
  UPTO_VALIDITY_SECONDS,
  computeSettleAmount,
} from '@/lib/constants';
import {
  activeWindowDurationSec,
  computeBillableWindow,
  type ParticipantEvent,
} from '@/lib/billing';
import { getSellerAddress } from '@/lib/cdp';
import { verifyWebhookSignature } from '@/lib/daily';
import {
  appendParticipantEvent,
  getSession,
  getSessionByRoomId,
  markSessionActive,
  markSessionCompleted,
  markSessionFailed,
  setBillableWindowEnd,
  setBillableWindowStart,
  type SessionRow,
} from '@/lib/db';
import { settleWithRetry } from '@/lib/x402';

export const runtime = 'nodejs';

/** Reconstructs the verify-time requirements from a stored session row. */
function buildVerifyRequirements(payTo: `0x${string}`): PaymentRequirements {
  return {
    scheme: 'upto',
    network: ACTIVE_CAIP2,
    asset: ACTIVE_USDC_ADDRESS,
    amount: M2_UPTO_MAX_ATOMIC.toString(),
    payTo,
    maxTimeoutSeconds: UPTO_VALIDITY_SECONDS,
    extra: {
      name: ACTIVE_USDC_DOMAIN.name,
      version: ACTIVE_USDC_DOMAIN.version,
      facilitatorAddress: ACTIVE_CDP_FACILITATOR_ADDRESS,
    },
  };
}

/**
 * Daily participant lifecycle event payload (subset). Field names mirror
 * Daily's webhook docs. `joined_at` / `left_at` are unix seconds.
 * `participant_id` is the per-meeting id (stable for the life of one
 * join — different from `user_id` which is per-Daily-account and not
 * present on anonymous joins).
 */
type DailyParticipantEvent = {
  version?: string;
  type?: string;
  id?: string;
  event_ts?: number;
  payload?: {
    room?: string;
    participant_id?: string;
    user_id?: string;
    joined_at?: number;
    left_at?: number;
    start_ts?: number;
    end_ts?: number;
    duration?: number;
  };
};

/** Daily's `meeting.ended` payload shape (subset). */
type MeetingEndedEvent = {
  version?: string;
  type?: string;
  id?: string;
  event_ts?: number;
  payload?: {
    start_ts?: number;
    end_ts?: number;
    meeting_id?: string;
    room?: string;
  };
};

/**
 * Build settle requirements with a duration-derived amount. Reconstructs
 * the verify shape verbatim and overrides only `amount`. The proxy
 * enforces `amount <= permitted.amount` on-chain.
 */
function buildSettleRequirements(
  payTo: `0x${string}`,
  durationSec: number,
): { settleRequirements: PaymentRequirements; settleAmountAtomic: bigint } {
  const verify = buildVerifyRequirements(payTo);
  const settleAmountAtomic = computeSettleAmount(durationSec);
  const settleRequirements: PaymentRequirements = {
    ...verify,
    amount: settleAmountAtomic.toString(),
  };
  return { settleRequirements, settleAmountAtomic };
}

/** base64 -> utf8 JSON -> PaymentPayload. Returns null on corrupt data. */
function decodeStoredPaymentPayload(b64: string): PaymentPayload | null {
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(decoded) as PaymentPayload;
  } catch (err) {
    console.error('[webhooks/daily] failed to decode payment_authorization_payload', err);
    return null;
  }
}

/**
 * Single funnel for on-chain settle + DDB persistence. Used by both the
 * participant.left primary path and the meeting.ended fallback.
 *
 * Idempotent via markSessionCompleted's ConditionExpression — a duplicate
 * call on a COMPLETED row hits ConditionalCheckFailedException, which
 * we treat as success ("already settled").
 *
 * On all-retries-exhausted, transitions row to SETTLE_FAILED so the
 * recap UI can surface a manual retry affordance.
 */
async function fireSettleAndPersist(
  session: SessionRow,
  durationSec: number,
  endedAtSec: number,
): Promise<{ ok: true; txHash: string } | { ok: false; reason: string; detail?: string }> {
  // Fast path: already in a terminal state. Saves a settle round-trip.
  if (
    session.status === 'COMPLETED' ||
    session.status === 'SETTLE_FAILED' ||
    session.status === 'TIMEOUT'
  ) {
    console.log(
      `[webhooks/daily] session ${session.session_id} already in status=${session.status}; ` +
        'skipping settle (idempotent).',
    );
    return { ok: true, txHash: session.settle_tx_hash ?? '' };
  }

  const paymentPayload = decodeStoredPaymentPayload(session.payment_authorization_payload);
  if (!paymentPayload) {
    return { ok: false, reason: 'corrupt_payload' };
  }

  const sellerAddress = await getSellerAddress();
  const { settleRequirements, settleAmountAtomic } = buildSettleRequirements(
    sellerAddress,
    durationSec,
  );

  console.log(
    `[webhooks/daily] settling session=${session.session_id} ` +
      `amount=${settleAmountAtomic} (${durationSec}s x ${M3_PER_SECOND_RATE_ATOMIC})`,
  );
  const settleResponse = await settleWithRetry(paymentPayload, settleRequirements);
  if (!settleResponse.success) {
    const reason = settleResponse.errorReason ?? 'settle_failed';
    const detail = settleResponse.errorMessage ?? '';
    console.error(`[webhooks/daily] settle failed: ${reason} ${detail}`);
    try {
      await markSessionFailed(session.session_id, {
        ended_at: endedAtSec,
        duration_sec: durationSec,
      });
    } catch (markErr) {
      console.error('[webhooks/daily] markSessionFailed also failed', markErr);
    }
    return { ok: false, reason, detail };
  }

  console.log(
    `[webhooks/daily] settled session=${session.session_id} tx=${settleResponse.transaction}`,
  );

  try {
    await markSessionCompleted(session.session_id, {
      settled_amount: Number(settleAmountAtomic),
      settle_tx_hash: settleResponse.transaction,
      ended_at: endedAtSec,
      duration_sec: durationSec,
    });
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      console.log(
        `[webhooks/daily] markSessionCompleted skipped — session ${session.session_id} ` +
          'already completed by a prior delivery.',
      );
      return { ok: true, txHash: settleResponse.transaction };
    }
    console.error('[webhooks/daily] markSessionCompleted failed', err);
    // On-chain tx already landed; failing here means our row is stale.
    // Returning ok:true is correct — Daily must NOT retry because that
    // would attempt another settle (which would fail at Permit2-nonce-
    // already-consumed but waste a round-trip).
    return { ok: true, txHash: settleResponse.transaction };
  }

  return { ok: true, txHash: settleResponse.transaction };
}

export async function POST(request: Request): Promise<NextResponse> {
  // Read body BEFORE any JSON parse so HMAC sees the exact bytes.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-webhook-signature');
  const timestampHeader = request.headers.get('x-webhook-timestamp');

  // HMAC verification. If DAILY_WEBHOOK_SECRET isn't set we're in the
  // initial-registration window where Daily sends a test ping before
  // we have the shared secret — accept and warn. Once the user adds
  // the secret to .env.local and restarts dev, we go strict.
  const secret = process.env.DAILY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn(
      '[webhooks/daily] DAILY_WEBHOOK_SECRET not set — accepting unverified ' +
        'request (likely Daily test ping during webhook registration). ' +
        'Add the hmac to .env.local and restart `pnpm dev` to enable verification.',
    );
  } else {
    const result = verifyWebhookSignature(rawBody, signatureHeader, timestampHeader, secret);
    if (!result.valid) {
      console.error('[webhooks/daily] HMAC signature verification failed.');
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }
    console.log(`[webhooks/daily] HMAC verified (variant=${result.variant ?? '?'})`);
  }

  let event: DailyParticipantEvent | MeetingEndedEvent;
  try {
    event = JSON.parse(rawBody) as DailyParticipantEvent | MeetingEndedEvent;
  } catch {
    return NextResponse.json({ ok: true, note: 'non-json body, ignored' }, { status: 200 });
  }

  const eventType = event.type ?? 'unknown';
  switch (eventType) {
    case 'participant.joined':
    case 'participant.left':
      return handleParticipantLifecycle(event as DailyParticipantEvent);
    case 'meeting.ended':
      return handleMeetingEnded(event as MeetingEndedEvent);
    default:
      console.log(`[webhooks/daily] ignoring event type=${eventType}`);
      return NextResponse.json(
        { ok: true, note: `event type ${eventType} not handled` },
        { status: 200 },
      );
  }
}

/**
 * Handle participant.joined / participant.left. Append the event,
 * recompute the active window over the full log, transition state on
 * window-open, fire settle on window-close.
 */
async function handleParticipantLifecycle(event: DailyParticipantEvent): Promise<NextResponse> {
  const payload = event.payload;
  if (!payload || typeof payload.room !== 'string' || payload.room.length === 0) {
    console.error('[webhooks/daily] participant event missing room', event);
    return NextResponse.json({ ok: false, note: 'missing room' }, { status: 200 });
  }
  const eventType = event.type === 'participant.joined' ? 'joined' : 'left';
  const participantId = payload.participant_id;
  if (!participantId) {
    console.error('[webhooks/daily] participant event missing participant_id', event);
    return NextResponse.json({ ok: false, note: 'missing participant_id' }, { status: 200 });
  }

  // Daily's joined_at / left_at are unix seconds (with potential
  // fractional precision). Convert to ms. Fall back through event_ts,
  // then Date.now() if nothing usable was sent.
  const evtUnixSec =
    eventType === 'joined'
      ? (payload.joined_at ?? event.event_ts)
      : (payload.left_at ?? event.event_ts);
  const timestamp_ms = typeof evtUnixSec === 'number' ? Math.floor(evtUnixSec * 1000) : Date.now();

  const session = await getSessionByRoomId(payload.room);
  if (!session) {
    console.error(`[webhooks/daily] no session found for room=${payload.room}`);
    return NextResponse.json({ ok: false, note: 'session not found' }, { status: 200 });
  }

  const newEvent: ParticipantEvent = {
    type: eventType,
    participant_id: participantId,
    timestamp_ms,
  };
  console.log(
    `[webhooks/daily] participant.${eventType} session=${session.session_id} ` +
      `participant=${participantId} ts=${timestamp_ms}`,
  );

  let updatedSession: SessionRow;
  try {
    updatedSession = await appendParticipantEvent(session.session_id, newEvent);
  } catch (err) {
    console.error('[webhooks/daily] appendParticipantEvent failed', err);
    return NextResponse.json({ error: 'append_failed' }, { status: 502 });
  }

  // Recompute over the FULL event log (not a delta). This is robust to
  // out-of-order delivery and at-least-once duplicates — the function
  // is pure over the log.
  const events = updatedSession.participant_events ?? [];
  const { start_ms, end_ms } = computeBillableWindow(events);

  // Window OPENED on this event (or earlier).
  if (start_ms !== undefined && updatedSession.billable_window_start_ms === undefined) {
    await setBillableWindowStart(session.session_id, start_ms);
    await markSessionActive(session.session_id);
    console.log(
      `[webhooks/daily] window OPENED session=${session.session_id} start_ms=${start_ms}`,
    );
  }

  // Window CLOSED on this event. Settle.
  if (end_ms !== undefined && updatedSession.billable_window_end_ms === undefined) {
    await setBillableWindowEnd(session.session_id, end_ms);
    const durationSec = activeWindowDurationSec(events);
    const endedAtSec = Math.floor(end_ms / 1000);
    console.log(
      `[webhooks/daily] window CLOSED session=${session.session_id} end_ms=${end_ms} ` +
        `duration_sec=${durationSec}`,
    );
    // Re-fetch the row so we have the latest status (markSessionActive
    // may have flipped it).
    const freshSession = (await getSession(session.session_id)) ?? updatedSession;
    const result = await fireSettleAndPersist(freshSession, durationSec, endedAtSec);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason, detail: result.detail ?? '' },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        sessionId: session.session_id,
        tx: result.txHash,
        duration_sec: durationSec,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, sessionId: session.session_id }, { status: 200 });
}

/**
 * Handle meeting.ended — fallback only. In the happy path settle has
 * already fired from participant.left. By the time this runs, the row
 * is COMPLETED and fireSettleAndPersist short-circuits.
 *
 * Edge case: both participants leave nearly-simultaneously such that
 * participant.left handler hasn't observed the count drop. We fall
 * back to computing duration over the event log (which by now MUST
 * contain both leaves) and fire settle from there.
 */
async function handleMeetingEnded(event: MeetingEndedEvent): Promise<NextResponse> {
  const payload = event.payload;
  if (!payload || typeof payload.room !== 'string' || payload.room.length === 0) {
    console.error('[webhooks/daily] meeting.ended missing room in payload', event);
    return NextResponse.json({ ok: false, note: 'missing room' }, { status: 200 });
  }

  const session = await getSessionByRoomId(payload.room);
  if (!session) {
    console.error(`[webhooks/daily] no session found for room=${payload.room}`);
    return NextResponse.json({ ok: false, note: 'session not found' }, { status: 200 });
  }

  if (
    session.status === 'COMPLETED' ||
    session.status === 'SETTLE_FAILED' ||
    session.status === 'TIMEOUT'
  ) {
    console.log(
      `[webhooks/daily] meeting.ended session=${session.session_id} ` +
        `already in status=${session.status}; idempotent ack.`,
    );
    return NextResponse.json({ ok: true, note: 'already settled' }, { status: 200 });
  }

  // Compute duration from the event log if present; fall back to
  // start_ts/end_ts from the meeting.ended payload (M3 path).
  const events = session.participant_events ?? [];
  let durationSec: number;
  let endedAtSec: number;
  if (events.length > 0) {
    durationSec = activeWindowDurationSec(events);
    const { end_ms } = computeBillableWindow(events);
    endedAtSec =
      end_ms !== undefined
        ? Math.floor(end_ms / 1000)
        : typeof payload.end_ts === 'number'
          ? Math.floor(payload.end_ts)
          : Math.floor(Date.now() / 1000);
  } else {
    const startTs = typeof payload.start_ts === 'number' ? payload.start_ts : 0;
    const endTs = typeof payload.end_ts === 'number' ? payload.end_ts : 0;
    durationSec = Math.max(0, endTs - startTs);
    endedAtSec = endTs > 0 ? Math.floor(endTs) : Math.floor(Date.now() / 1000);
  }

  console.log(
    `[webhooks/daily] meeting.ended FALLBACK session=${session.session_id} ` +
      `duration_sec=${durationSec} (event_log_len=${events.length})`,
  );

  const result = await fireSettleAndPersist(session, durationSec, endedAtSec);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, detail: result.detail ?? '' },
      { status: 502 },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      sessionId: session.session_id,
      tx: result.txHash,
      duration_sec: durationSec,
    },
    { status: 200 },
  );
}
