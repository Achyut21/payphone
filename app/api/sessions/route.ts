/**
 * POST /api/sessions — x402-protected session creation (M1).
 *
 * Behavior (RESEARCH_DOSSIER.md §2):
 *   1. No X-PAYMENT header           → HTTP 402 + PaymentRequired (exact, $0.10)
 *   2. X-PAYMENT present + invalid   → HTTP 402 + reason
 *   3. X-PAYMENT present + valid     → call /settle (with retry-with-backoff)
 *      - settle success              → HTTP 200 { sessionId, paymentTx }
 *      - settle fail after 3 retries → HTTP 402 + reason
 *
 * M1 hardcodes $0.10 (USDC atomic = 100_000) on Base Sepolia using the EVM
 * `exact` scheme. M2 will swap to the `upto` scheme; this route handler
 * shape stays the same except for the PaymentRequirements builder.
 *
 * NOTE: nodejs runtime — Edge runtime breaks the CDP SDK's ed25519 JWT signer
 * (uses Node's crypto module, not Web Crypto).
 */

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types';

import {
  ACTIVE_CAIP2,
  ACTIVE_USDC_ADDRESS,
  ACTIVE_USDC_DOMAIN,
  M1_PRICE_ATOMIC,
  M1_PRICE_USD,
  X402_VERSION,
} from '@/lib/constants';
import { getSellerAddress } from '@/lib/cdp';
import { settleWithRetry, verify } from '@/lib/x402';

export const runtime = 'nodejs';

/** Maximum seconds the buyer's signed authorization remains valid. */
const MAX_TIMEOUT_SECONDS = 60;

/**
 * Build the PaymentRequirements for this request. The SAME object (deep-equal)
 * must be used both in the 402 response AND in verify/settle — otherwise the
 * EIP-712 hash differs and the signature won't validate.
 */
function buildRequirements(payTo: `0x${string}`): PaymentRequirements {
  return {
    scheme: 'exact',
    network: ACTIVE_CAIP2,
    asset: ACTIVE_USDC_ADDRESS,
    amount: M1_PRICE_ATOMIC.toString(),
    payTo,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: {
      // EIP-712 domain bits the buyer needs to reproduce. NOTE: USDC's `name`
      // differs by network — "USD Coin" on mainnet, "USDC" on Sepolia. We
      // pull from ACTIVE_USDC_DOMAIN so the M5 flip is automatic.
      name: ACTIVE_USDC_DOMAIN.name,
      version: ACTIVE_USDC_DOMAIN.version,
    },
  };
}

/** Build the 402 response body advertising what payment we'll accept. */
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
      description: `PayPhone session creation — $${M1_PRICE_USD} USDC on Base Sepolia (M1)`,
      mimeType: 'application/json',
    },
    accepts: [requirements],
  };
}

/**
 * Build a 402 NextResponse. The x402 v2 client reads PaymentRequired from the
 * `PAYMENT-REQUIRED` response header (base64 JSON). The JSON body is
 * informational only for v2 (and a fallback for v1 clients).
 *
 * `Access-Control-Expose-Headers` is set so a browser-based buyer agent can
 * read the header through CORS — harmless for our Node test, useful later.
 */
function paymentRequiredResponse(paymentRequired: PaymentRequired): NextResponse {
  return NextResponse.json(paymentRequired, {
    status: 402,
    headers: {
      'PAYMENT-REQUIRED': encodePaymentRequiredHeader(paymentRequired),
      'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE',
    },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const sellerAddress = await getSellerAddress();
  const requirements = buildRequirements(sellerAddress);
  const resourceUrl = new URL(request.url).toString();

  // x402 v2 sends the signed payload in `PAYMENT-SIGNATURE`. v1 used `X-PAYMENT`;
  // we accept both for forward/back compatibility but prefer v2.
  const paymentHeader =
    request.headers.get('PAYMENT-SIGNATURE') ?? request.headers.get('X-PAYMENT');
  if (!paymentHeader || paymentHeader.length === 0) {
    // No payment yet — advertise what we want.
    return paymentRequiredResponse(buildPaymentRequired(resourceUrl, requirements));
  }

  // Decode the signed payload. A malformed header is treated as "no payment".
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(paymentHeader);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Malformed X-PAYMENT header';
    return paymentRequiredResponse(buildPaymentRequired(resourceUrl, requirements, message));
  }

  // 1. Verify with the facilitator.
  const verifyResponse = await verify(paymentPayload, requirements);
  if (!verifyResponse.isValid) {
    const reason = verifyResponse.invalidReason ?? 'verify rejected';
    const detail = verifyResponse.invalidMessage ?? '';
    return paymentRequiredResponse(
      buildPaymentRequired(resourceUrl, requirements, `${reason}: ${detail}`.trim()),
    );
  }

  // 2. Settle on-chain with retry-with-backoff.
  const settleResponse = await settleWithRetry(paymentPayload, requirements);
  if (!settleResponse.success) {
    const reason = settleResponse.errorReason ?? 'settle failed';
    const detail = settleResponse.errorMessage ?? '';
    return paymentRequiredResponse(
      buildPaymentRequired(resourceUrl, requirements, `${reason}: ${detail}`.trim()),
    );
  }

  // 3. Payment settled. Return the session id + tx hash.
  // The PAYMENT-RESPONSE header lets the buyer agent read settle metadata
  // out-of-band; the JSON body carries the same plus our session id.
  // M1: sessionId is a fresh UUID, persisted nowhere. M3 will write to DDB.
  const sessionId = randomUUID();
  return NextResponse.json(
    {
      sessionId,
      paymentTx: settleResponse.transaction,
      payer: settleResponse.payer ?? verifyResponse.payer ?? null,
      network: settleResponse.network,
    },
    {
      status: 200,
      headers: {
        'PAYMENT-RESPONSE': encodePaymentResponseHeader(settleResponse),
        'Access-Control-Expose-Headers': 'PAYMENT-RESPONSE, X-PAYMENT-RESPONSE',
      },
    },
  );
}
