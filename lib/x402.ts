/**
 * PayPhone — x402 facilitator client + retry-with-backoff for /settle.
 *
 * Wraps `@x402/core/http`'s HTTPFacilitatorClient configured against the
 * Coinbase CDP facilitator (auth headers come from `@coinbase/x402`). All
 * route handlers go through this module — never call the facilitator HTTP
 * endpoints directly.
 *
 * RESEARCH_DOSSIER.md §2: settle has a known ~40% intermittent failure rate
 * on Base mainnet ("unable to estimate gas"). We mitigate with 3 attempts at
 * 2s / 5s / 10s backoff. M1 runs on Sepolia where this issue is uncommon,
 * but we wire the retry now so M5 mainnet flip is zero-code.
 */

import { facilitator as cdpFacilitatorConfig } from '@coinbase/x402';
import { HTTPFacilitatorClient } from '@x402/core/http';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '@x402/core/types';

let _client: HTTPFacilitatorClient | null = null;

/**
 * Returns a singleton facilitator client. Constructs lazily so importing
 * this module doesn't validate env until first call.
 */
export function getFacilitatorClient(): HTTPFacilitatorClient {
  if (_client === null) {
    _client = new HTTPFacilitatorClient(cdpFacilitatorConfig);
  }
  return _client;
}

/**
 * Verify a payment payload against requirements. Pure passthrough — no retry
 * because verify is fast (~100ms) and deterministic; if it fails, retrying
 * won't change the outcome.
 */
export async function verify(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): Promise<VerifyResponse> {
  return getFacilitatorClient().verify(paymentPayload, paymentRequirements);
}

/** Backoff schedule in ms. Three attempts: try → wait → retry → wait → retry. */
const SETTLE_BACKOFFS_MS: readonly number[] = [2000, 5000, 10000] as const;

/**
 * Settle a payment, retrying on transient facilitator failures. Returns the
 * SettleResponse from the FIRST successful attempt, or the last failure
 * response after all retries are exhausted.
 *
 * Per CONTEXT.md and RESEARCH_DOSSIER.md, we deliberately do NOT pass an
 * idempotencyKey — Coinbase's open issue #1065 indicates that masks the bug
 * rather than fixing it. The facilitator's settle is naturally idempotent
 * because the EIP-3009 / Permit2 nonce in the signed payload prevents double
 * spend on-chain.
 */
export async function settleWithRetry(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): Promise<SettleResponse> {
  const client = getFacilitatorClient();
  let lastResponse: SettleResponse | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < SETTLE_BACKOFFS_MS.length; attempt++) {
    try {
      const response = await client.settle(paymentPayload, paymentRequirements);
      if (response.success) {
        return response;
      }
      lastResponse = response;
      // Log without leaking the payload — only the high-level reason / tx hash
      // are useful for debugging and safe to log.
      console.warn(
        `[x402.settle] attempt ${attempt + 1}/${SETTLE_BACKOFFS_MS.length} failed:`,
        response.errorReason ?? 'unknown',
        response.errorMessage ?? '',
      );
    } catch (err) {
      lastError = err;
      console.warn(
        `[x402.settle] attempt ${attempt + 1}/${SETTLE_BACKOFFS_MS.length} threw:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    // Don't sleep after the last attempt.
    if (attempt < SETTLE_BACKOFFS_MS.length - 1) {
      const backoffMs = SETTLE_BACKOFFS_MS[attempt];
      if (backoffMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  // All attempts failed. If we have a structured response from the facilitator,
  // return it so callers can inspect errorReason. If we only have an exception,
  // synthesize a SettleResponse-shaped failure.
  if (lastResponse !== null) {
    return lastResponse;
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`settle failed after ${SETTLE_BACKOFFS_MS.length} attempts`);
}
