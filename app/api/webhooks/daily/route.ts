/**
 * POST /api/webhooks/daily — Daily.co webhook receiver.
 *
 * Settles the buyer's x402 upto authorization based on actual call
 * duration when Daily fires `meeting.ended`. This is the moment that
 * makes PayPhone's per-second billing real: the unspent allowance
 * stays unspent on-chain.
 *
 * Architectural note: CONTEXT.md describes "AWS Lambda for the Daily.co
 * webhook receiver" as a separate service. M3 consolidates this into a
 * Next.js API route — when deployed to AWS Amplify in M5, this route
 * runs as a Lambda automatically. Same compute model, less plumbing.
 *
 * Flow on `meeting.ended`:
 *   1. Read raw body (req.text()) — HMAC needs the exact bytes.
 *   2. Verify HMAC signature with DAILY_WEBHOOK_SECRET. If env var is
 *      unset (initial registration window), accept and warn — Daily's
 *      test ping arrives before we have the secret.
 *   3. Parse JSON. Skip non-`meeting.ended` events with a 200.
 *   4. Compute duration_sec = end_ts - start_ts.
 *   5. Look up session by room name (DDB Scan).
 *   6. Reconstruct verifyRequirements (same shape as /api/sessions),
 *      spread `{ ..., amount: computeSettleAmount(duration_sec) }` for
 *      settle.
 *   7. Decode the buyer's stored PaymentPayload (base64 → JSON) and
 *      call settleWithRetry.
 *   8. Mark session COMPLETED via UpdateItem with conditional
 *      `status = AUTHORIZED` — this is the double-settle guard. If
 *      Daily retries (our 200 was lost in transit), the conditional
 *      update fails with ConditionalCheckFailedException; we catch it
 *      and return 200 so Daily stops retrying.
 *
 * Daily's retry policy (docs §retryType, default circuit-breaker):
 *   3 failures → circuit breaks → no further deliveries until a manual
 *   re-activate. 200 responses reset the failure counter. So we lean
 *   toward 200 for any "we got it, stop retrying" outcome (including
 *   already-settled), and 5xx only for genuine transient failures we
 *   want Daily to retry.
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
import { getSellerAddress } from '@/lib/cdp';
import { verifyWebhookSignature } from '@/lib/daily';
import { getSessionByRoomId, markSessionCompleted } from '@/lib/db';
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

/** Daily's `meeting.ended` payload shape (subset we use). */
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

export async function POST(request: Request): Promise<NextResponse> {
  // Read body BEFORE any JSON parse so HMAC sees the exact bytes Daily sent.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-webhook-signature');
  const timestampHeader = request.headers.get('x-webhook-timestamp');

  // HMAC verification. If DAILY_WEBHOOK_SECRET isn't set we're in the
  // initial-registration window where Daily sends a test ping before we
  // have the shared secret — accept and warn. Once the user adds the
  // secret to .env.local and restarts dev, we go strict.
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

  // Parse JSON. Daily's test ping is a small JSON body too; we accept any
  // event we don't recognize with a 200 so registration succeeds.
  let event: MeetingEndedEvent;
  try {
    event = JSON.parse(rawBody) as MeetingEndedEvent;
  } catch {
    // Empty or non-JSON body. Likely a probe; 200 is friendly.
    return NextResponse.json({ ok: true, note: 'non-json body, ignored' }, { status: 200 });
  }

  // Only meeting.ended drives settle. Other events (meeting.started,
  // participant.joined, test pings) get a 200 with no side-effects.
  // Realtime transcription is captured CLIENT-SIDE in components/SessionRoom
  // via the Daily JS SDK — Daily's webhook surface does not include
  // per-utterance events, only `transcript.ready-to-download` (which fires
  // post-meeting after storage is finalized; we don't use it).
  if (event.type !== 'meeting.ended') {
    console.log(`[webhooks/daily] ignoring event type=${event.type ?? 'unknown'}`);
    return NextResponse.json(
      { ok: true, note: `event type ${event.type ?? 'unknown'} not handled` },
      { status: 200 },
    );
  }

  const payload = event.payload;
  if (!payload || typeof payload.room !== 'string' || payload.room.length === 0) {
    console.error('[webhooks/daily] meeting.ended missing room in payload', event);
    // Return 200 — we can't process this and don't want Daily to retry it.
    return NextResponse.json({ ok: false, note: 'missing room' }, { status: 200 });
  }

  // Daily reports start_ts/end_ts, not duration. Compute it ourselves.
  const startTs = typeof payload.start_ts === 'number' ? payload.start_ts : 0;
  const endTs = typeof payload.end_ts === 'number' ? payload.end_ts : 0;
  const durationSec = Math.max(0, endTs - startTs);

  console.log(`[webhooks/daily] meeting.ended room=${payload.room} duration_sec=${durationSec}`);

  // Find the session row by room name.
  const session = await getSessionByRoomId(payload.room);
  if (!session) {
    console.error(`[webhooks/daily] no session found for room=${payload.room}`);
    // 200: there's nothing for us to do, and Daily retrying won't change
    // that. (Could happen if the meeting was for a manually-created room
    // that wasn't part of a paid session.)
    return NextResponse.json({ ok: false, note: 'session not found' }, { status: 200 });
  }

  // If we already settled this session, exit early. The DDB conditional
  // update below would also catch this, but checking up front saves a
  // settle round-trip on retry.
  if (session.status !== 'AUTHORIZED') {
    console.log(
      `[webhooks/daily] session ${session.session_id} already in status=${session.status}; ` +
        'returning 200 (idempotent retry).',
    );
    return NextResponse.json({ ok: true, note: 'already settled' }, { status: 200 });
  }

  // Reconstruct the upto requirements verbatim from session-creation time
  // and override only the amount. The buyer's witness allows any
  // amount ≤ permitted.amount; the proxy enforces this on-chain.
  //
  // payTo MUST be the seller — the buyer signed the witness binding funds
  // to that address. agent_wallet_addr in the row is the BUYER (audit/log
  // only). We re-resolve the seller via the memoized CDP helper rather
  // than persisting it to DDB to keep the schema lean.
  const sellerAddress = await getSellerAddress();
  const verifyRequirements = buildVerifyRequirements(sellerAddress);
  const settleAmountAtomic = computeSettleAmount(durationSec);
  const settleRequirements: PaymentRequirements = {
    ...verifyRequirements,
    amount: settleAmountAtomic.toString(),
  };

  // Decode the stored PaymentPayload. base64 → utf-8 JSON → typed object.
  let paymentPayload: PaymentPayload;
  try {
    const decoded = Buffer.from(session.payment_authorization_payload, 'base64').toString('utf8');
    paymentPayload = JSON.parse(decoded) as PaymentPayload;
  } catch (err) {
    console.error('[webhooks/daily] failed to decode payment_authorization_payload', err);
    return NextResponse.json({ error: 'corrupt_payload' }, { status: 500 });
  }

  // The webhook reconstructs requirements from constants + session row,
  // not from the original signing context. As long as the constants
  // haven't changed since session creation (they shouldn't have — we're
  // talking minutes), the EIP-712 hash will match what the buyer signed.
  console.log(
    `[webhooks/daily] settling session=${session.session_id} ` +
      `amount=${settleAmountAtomic} (${durationSec}s × ${M3_PER_SECOND_RATE_ATOMIC})`,
  );
  const settleResponse = await settleWithRetry(paymentPayload, settleRequirements);
  if (!settleResponse.success) {
    const reason = settleResponse.errorReason ?? 'settle_failed';
    const detail = settleResponse.errorMessage ?? '';
    console.error(`[webhooks/daily] settle failed: ${reason} ${detail}`);
    // 5xx → Daily retries. The retry will hit our idempotency check above
    // (if the prior attempt actually landed on-chain but the response was
    // lost) or get another fresh settle attempt.
    return NextResponse.json({ error: reason, detail }, { status: 502 });
  }

  console.log(
    `[webhooks/daily] settled session=${session.session_id} tx=${settleResponse.transaction}`,
  );

  // Persist the result. Conditional on status=AUTHORIZED — guards against
  // a double-mark on a Daily retry where settle was idempotent on-chain
  // (Permit2 nonce single-use) but our previous response was lost.
  try {
    await markSessionCompleted(session.session_id, {
      settled_amount: Number(settleAmountAtomic),
      settle_tx_hash: settleResponse.transaction,
      ended_at: endTs > 0 ? endTs : Math.floor(Date.now() / 1000),
      duration_sec: durationSec,
    });
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      console.log(
        `[webhooks/daily] markSessionCompleted skipped — session ${session.session_id} ` +
          'already completed by a prior delivery. Returning 200.',
      );
      return NextResponse.json({ ok: true, note: 'already completed' }, { status: 200 });
    }
    console.error('[webhooks/daily] markSessionCompleted failed', err);
    // The on-chain tx already landed; failing here would cause Daily to
    // retry, which would re-send settle, which would fail (Permit2 nonce
    // already consumed). 200 to stop retries; the row is just stale.
    return NextResponse.json(
      { ok: false, note: 'settled on-chain but DDB update failed', tx: settleResponse.transaction },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      sessionId: session.session_id,
      tx: settleResponse.transaction,
      duration_sec: durationSec,
      settled_amount: settleAmountAtomic.toString(),
    },
    { status: 200 },
  );
}
