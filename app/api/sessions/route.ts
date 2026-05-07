/**
 * POST /api/sessions — x402-protected session creation (M3).
 *
 * The M3 shape, vs. M2:
 *   - M2 verified the buyer's upto witness, then immediately settled for a
 *     hardcoded $0.30, then returned the tx hash. The "session" was just
 *     a UUID with no persistence and no video.
 *   - M3 verifies the witness, creates a real Daily.co room, persists a
 *     session row in DynamoDB, and returns `{ sessionId, roomUrl,
 *     maxAuthorized }` WITHOUT settling. Settlement now happens in
 *     `/api/webhooks/daily` when the meeting ends, with the duration-
 *     derived amount instead of a hardcoded one.
 *
 * Why defer settle to the webhook:
 *   The whole point of `upto` is that the on-chain settle amount is
 *   driven by actual usage, not by what was charged at request time.
 *   That requires waiting for the meeting to end. Permit2 nonce
 *   single-use property still prevents double-spend; the buyer's
 *   signature stays valid until `deadline` (now + UPTO_VALIDITY_SECONDS)
 *   and is consumed exactly once when the webhook calls `settle()`.
 *
 * Failure modes (and what happens):
 *   - Verify fails:  HTTP 402 + reason. No room created, no DDB write.
 *   - Daily fails:   HTTP 500. Buyer's signature stays unused on-chain;
 *                    the Permit2 nonce expires naturally at deadline. No
 *                    funds moved.
 *   - DDB fails:     HTTP 500. Daily room exists but is orphan (auto-
 *                    expires at room.exp). Same: no on-chain effect.
 *   - All success:   HTTP 200 with sessionId/roomUrl/maxAuthorized.
 *                    Buyer opens roomUrl. Webhook handles settlement.
 *
 * `runtime = 'nodejs'` because CDP SDK + AWS SDK are both Node-only.
 */

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { z } from 'zod';

import {
  ACTIVE_CAIP2,
  ACTIVE_CDP_FACILITATOR_ADDRESS,
  ACTIVE_USDC_ADDRESS,
  ACTIVE_USDC_DOMAIN,
  M2_UPTO_MAX_ATOMIC,
  M2_UPTO_MAX_USD,
  UPTO_VALIDITY_SECONDS,
  X402_VERSION,
} from '@/lib/constants';
import { getSellerAddress } from '@/lib/cdp';
import { verify } from '@/lib/x402';
import { createRoom } from '@/lib/daily';
import { createSession, type SessionRow } from '@/lib/db';

export const runtime = 'nodejs';

/** TTL for the DDB session row: 24h after creation. M5 stretch may shorten. */
const SESSION_ROW_TTL_SECONDS = 24 * 60 * 60;

/**
 * Request body schema. All fields optional — the M3 CLI sent only `topic`,
 * which the route ignored. M4 adds `userId`/`expertId` so the marketplace
 * can persist who initiated the call and which expert was picked. We
 * keep the M3 shape backward-compatible by falling back to sentinel
 * values when fields are missing (so rerunning the M3 CLI still works
 * for diagnostic purposes — the persisted row will just have
 * `seed-buyer` / `seed-expert`).
 */
const SessionRequestBodySchema = z.object({
  topic: z.string().optional(),
  userId: z.string().min(1).optional(),
  expertId: z.string().min(1).optional(),
});

/**
 * Build the PaymentRequirements for verify. The webhook reconstructs this
 * exact shape (same payTo, same MAX amount) and spreads `{ ..., amount:
 * durationDerived }` for settle. The buyer's witness is signed over the
 * EIP-712 hash of the MAX requirements, so verify and the original
 * signing context must match byte-for-byte; only `amount` legally varies
 * at settle time per the upto scheme.
 *
 * `extra.facilitatorAddress` is mandatory: the witness binds settlement
 * to that address so only the CDP facilitator's signer can call settle()
 * on the proxy.
 */
function buildRequirements(payTo: `0x${string}`, amountAtomic: bigint): PaymentRequirements {
  return {
    scheme: 'upto',
    network: ACTIVE_CAIP2,
    asset: ACTIVE_USDC_ADDRESS,
    amount: amountAtomic.toString(),
    payTo,
    maxTimeoutSeconds: UPTO_VALIDITY_SECONDS,
    extra: {
      // EIP-712 domain bits for USDC. NOTE: USDC's `name` differs by network —
      // "USD Coin" on mainnet, "USDC" on Sepolia. ACTIVE_USDC_DOMAIN handles
      // the M5 mainnet flip automatically.
      name: ACTIVE_USDC_DOMAIN.name,
      version: ACTIVE_USDC_DOMAIN.version,
      // The CDP facilitator signer that's authorized to call settle() on the
      // proxy. The buyer's signed witness binds settlement to this address.
      facilitatorAddress: ACTIVE_CDP_FACILITATOR_ADDRESS,
    },
  };
}

function buildPaymentRequired(
  resourceUrl: string,
  requirements: PaymentRequirements,
  errorMessage?: string,
): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    ...(errorMessage ? { error: errorMessage } : {}),
    resource: {
      url: resourceUrl,
      description: `PayPhone session — up to $${M2_UPTO_MAX_USD} USDC on Base Sepolia (M3)`,
      mimeType: 'application/json',
    },
    accepts: [requirements],
    extensions: {
      eip2612GasSponsoring: {},
      erc20ApprovalGasSponsoring: {},
    },
  };
}

function paymentRequiredResponse(paymentRequired: PaymentRequired): NextResponse {
  return NextResponse.json(paymentRequired, {
    status: 402,
    headers: {
      'PAYMENT-REQUIRED': encodePaymentRequiredHeader(paymentRequired),
      'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED',
    },
  });
}

/**
 * Encode the buyer's signed PaymentPayload for storage in DDB. We round-
 * trip this verbatim into the webhook so settle uses the exact same
 * bytes. JSON.stringify → utf-8 → base64 keeps it as an ASCII-safe DDB
 * string attribute; base64 (vs hex) saves ~25% on a payload that's a
 * couple of KB.
 *
 * Sensitivity: this contains a Permit2 witness signature, NOT the wallet's
 * private key. Anyone holding it could try to submit settle, but settle
 * is bound to `extra.facilitatorAddress` (the CDP facilitator) so only
 * they can actually use it. We still treat it as scoped data — only the
 * runtime IAM user with table-only access can read it.
 */
function encodePaymentPayloadForStorage(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export async function POST(request: Request): Promise<NextResponse> {
  // Read body up front. Buyer agent sends JSON `{ topic, userId, expertId }`.
  // The x402 dance only reads the `PAYMENT-SIGNATURE` header — so consuming
  // the body stream here doesn't conflict. Failures (empty body, malformed
  // JSON) fall back to sentinel values for M3-CLI compatibility.
  let parsedBody: z.infer<typeof SessionRequestBodySchema> = {};
  try {
    const bodyText = await request.text();
    if (bodyText.length > 0) {
      const parseResult = SessionRequestBodySchema.safeParse(JSON.parse(bodyText));
      if (parseResult.success) {
        parsedBody = parseResult.data;
      }
    }
  } catch {
    // Non-JSON or stream errors — fall through to sentinels below.
  }
  const persistedUserId = parsedBody.userId ?? 'seed-buyer';
  const persistedExpertId = parsedBody.expertId ?? 'seed-expert';

  const sellerAddress = await getSellerAddress();
  const verifyRequirements = buildRequirements(sellerAddress, M2_UPTO_MAX_ATOMIC);
  const resourceUrl = new URL(request.url).toString();

  const paymentHeader =
    request.headers.get('PAYMENT-SIGNATURE') ?? request.headers.get('X-PAYMENT');
  if (!paymentHeader || paymentHeader.length === 0) {
    return paymentRequiredResponse(buildPaymentRequired(resourceUrl, verifyRequirements));
  }

  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(paymentHeader);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Malformed PAYMENT-SIGNATURE header';
    return paymentRequiredResponse(buildPaymentRequired(resourceUrl, verifyRequirements, message));
  }

  // 1. Verify with MAX. The facilitator validates the signature against a
  //    Permit2 witness for $5 — that's what the buyer actually signed.
  //    Settle is deferred to the webhook (M3 change vs M2).
  const verifyResponse = await verify(paymentPayload, verifyRequirements);
  if (!verifyResponse.isValid) {
    const reason = verifyResponse.invalidReason ?? 'verify rejected';
    const detail = verifyResponse.invalidMessage ?? '';
    return paymentRequiredResponse(
      buildPaymentRequired(resourceUrl, verifyRequirements, `${reason}: ${detail}`.trim()),
    );
  }

  // 2. Mint a session id and create the Daily room. We do Daily BEFORE the
  //    DDB write so we can store room_id/url in the same PutItem (single
  //    write, simpler failure surface). If Daily fails here, no DDB row
  //    exists and the buyer's witness goes unused on-chain — same outcome
  //    as a verify-only request.
  const sessionId = randomUUID();
  let room;
  try {
    room = await createRoom();
  } catch (err) {
    console.error('[sessions] Daily createRoom failed:', err);
    return NextResponse.json(
      { error: 'video_room_creation_failed', detail: err instanceof Error ? err.message : '' },
      { status: 500 },
    );
  }

  // 3. Persist the session. status=AUTHORIZED — the webhook flips to
  //    COMPLETED on settle success (atomically, conditional on still
  //    being AUTHORIZED, which guards against double-settle on retries).
  const nowMs = Date.now();
  const startedAt = Math.floor(nowMs / 1000);
  const payer =
    (verifyResponse.payer as `0x${string}` | undefined) ??
    ((paymentPayload.payload as { permit?: { permitted?: { owner?: string } } } | undefined)?.permit
      ?.permitted?.owner as `0x${string}` | undefined) ??
    ('0x0000000000000000000000000000000000000000' as `0x${string}`);
  const row: SessionRow = {
    session_id: sessionId,
    // M4: real user/expert ids from the marketplace request body. M3-CLI
    // calls (no body) fall through to the sentinels above, preserving
    // the diagnostic flow.
    user_id: persistedUserId,
    expert_id: persistedExpertId,
    agent_wallet_addr: payer,
    payment_authorization_payload: encodePaymentPayloadForStorage(paymentPayload),
    video_room_id: room.name, // 'name' matches the webhook payload's `room` field
    video_room_url: room.url,
    started_at: startedAt,
    // M4.9: ms-precision creation time for the 90s no-expert-joined
    // timeout. The status route compares this against Date.now() to
    // decide whether a still-AUTHORIZED session should transition to
    // TIMEOUT.
    started_at_ms: nowMs,
    max_authorized_amount: Number(M2_UPTO_MAX_ATOMIC),
    status: 'AUTHORIZED',
    expires_at: startedAt + SESSION_ROW_TTL_SECONDS,
  };
  try {
    await createSession(row);
  } catch (err) {
    console.error('[sessions] DDB createSession failed:', err);
    return NextResponse.json(
      { error: 'session_persist_failed', detail: err instanceof Error ? err.message : '' },
      { status: 500 },
    );
  }

  // 4. Hand the room URL back. Buyer joins; meeting.ended webhook will
  //    drive settlement. We deliberately do NOT include a paymentTx here
  //    — there isn't one yet, and surfacing one would be misleading.
  return NextResponse.json(
    {
      sessionId,
      roomUrl: room.url,
      maxAuthorized: M2_UPTO_MAX_USD,
      payer,
      network: ACTIVE_CAIP2,
      status: 'AUTHORIZED',
    },
    { status: 200 },
  );
}
