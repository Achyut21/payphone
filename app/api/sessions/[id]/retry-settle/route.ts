/**
 * POST /api/sessions/[id]/retry-settle — manual retry for SETTLE_FAILED.
 *
 * When the webhook's settleWithRetry exhausted all 3 attempts and the
 * row was marked SETTLE_FAILED, the buyer sees a "Retry settlement"
 * button on the recap (Phase 6). That button POSTs to this endpoint.
 *
 * Flow:
 *   1. Auth + ownership gate via `requireSessionOwner`. The endpoint
 *      is under /api/* which the proxy doesn't cover; the helper does
 *      both the cookie check AND the ownership check inline. Non-owner
 *      gets 404 (no existence leak), unauthenticated gets 401.
 *   2. Verify status === SETTLE_FAILED. Anything else is a no-op
 *      idempotent success (the recap might be stale).
 *   3. Reconstruct the settle requirements using the row's persisted
 *      `duration_sec` (the duration the failed settle was for — this
 *      is locked in DDB so a retry settles for exactly the same
 *      amount the buyer already saw).
 *   4. Decode the stored PaymentPayload + call settleWithRetry.
 *   5. On success: markSessionRetrySettled (SETTLE_FAILED -> COMPLETED).
 *   6. On failure: leave row in SETTLE_FAILED and surface the error.
 *
 * Idempotency: if the buyer double-clicks, the second call hits the
 * status-check and short-circuits. If two clicks race past that
 * check, the SECOND markSessionRetrySettled hits its conditional
 * (status = SETTLE_FAILED) which fails because the FIRST already
 * flipped to COMPLETED. The Permit2 nonce is single-use anyway — only
 * one of the two settle attempts can land on-chain.
 *
 * `runtime = 'nodejs'` — uses CDP SDK + AWS SDK + crypto.
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
  UPTO_VALIDITY_SECONDS,
  computeSettleAmount,
} from '@/lib/constants';
import { getSellerAddress } from '@/lib/cdp';
import { markSessionRetrySettled } from '@/lib/db';
import { requireSessionOwner } from '@/lib/session-auth';
import { settleWithRetry } from '@/lib/x402';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id || id.length === 0) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  const guard = await requireSessionOwner(id);
  if (!guard.ok) return guard.response;
  const { row: session } = guard;

  // Idempotent fast paths.
  if (session.status === 'COMPLETED') {
    return NextResponse.json(
      { ok: true, note: 'already settled', tx: session.settle_tx_hash ?? '' },
      { status: 200 },
    );
  }
  if (session.status !== 'SETTLE_FAILED') {
    // AUTHORIZED / ACTIVE / TIMEOUT — none of these support retry.
    return NextResponse.json(
      { error: 'invalid_state', detail: `cannot retry from status=${session.status}` },
      { status: 409 },
    );
  }

  // Reconstruct the settle requirements with the duration the original
  // attempt was for. duration_sec was persisted at SETTLE_FAILED time;
  // using the same value means the buyer pays exactly what the recap
  // (and the original failed attempt) showed.
  const durationSec = session.duration_sec ?? 0;
  const sellerAddress = await getSellerAddress();
  const verifyRequirements: PaymentRequirements = {
    scheme: 'upto',
    network: ACTIVE_CAIP2,
    asset: ACTIVE_USDC_ADDRESS,
    amount: M2_UPTO_MAX_ATOMIC.toString(),
    payTo: sellerAddress,
    maxTimeoutSeconds: UPTO_VALIDITY_SECONDS,
    extra: {
      name: ACTIVE_USDC_DOMAIN.name,
      version: ACTIVE_USDC_DOMAIN.version,
      facilitatorAddress: ACTIVE_CDP_FACILITATOR_ADDRESS,
    },
  };
  const settleAmountAtomic = computeSettleAmount(durationSec);
  const settleRequirements: PaymentRequirements = {
    ...verifyRequirements,
    amount: settleAmountAtomic.toString(),
  };

  // Decode the stored payload.
  let paymentPayload: PaymentPayload;
  try {
    const decoded = Buffer.from(session.payment_authorization_payload, 'base64').toString('utf8');
    paymentPayload = JSON.parse(decoded) as PaymentPayload;
  } catch (err) {
    console.error('[retry-settle] corrupt payload', err);
    return NextResponse.json({ error: 'corrupt_payload' }, { status: 500 });
  }

  console.log(
    `[retry-settle] session=${session.session_id} amount=${settleAmountAtomic} duration=${durationSec}s`,
  );
  const settleResponse = await settleWithRetry(paymentPayload, settleRequirements);
  if (!settleResponse.success) {
    const reason = settleResponse.errorReason ?? 'settle_failed';
    const detail = settleResponse.errorMessage ?? '';
    console.error(`[retry-settle] retry failed: ${reason} ${detail}`);
    return NextResponse.json({ error: reason, detail, retryable: true }, { status: 502 });
  }

  console.log(
    `[retry-settle] settled session=${session.session_id} tx=${settleResponse.transaction}`,
  );

  try {
    await markSessionRetrySettled(session.session_id, {
      settled_amount: Number(settleAmountAtomic),
      settle_tx_hash: settleResponse.transaction,
    });
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      // Someone else's retry beat us — that's fine.
      console.log(`[retry-settle] markSessionRetrySettled skipped — already completed.`);
      return NextResponse.json(
        { ok: true, tx: settleResponse.transaction, note: 'already completed by concurrent retry' },
        { status: 200 },
      );
    }
    console.error('[retry-settle] markSessionRetrySettled failed', err);
    // On-chain tx already landed; row stays SETTLE_FAILED. Best-effort.
    return NextResponse.json(
      {
        ok: true,
        tx: settleResponse.transaction,
        note: 'settled on-chain but DDB update failed',
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      sessionId: session.session_id,
      tx: settleResponse.transaction,
      settled_amount: settleAmountAtomic.toString(),
    },
    { status: 200 },
  );
}
