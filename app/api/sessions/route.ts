/**
 * POST /api/sessions — x402-protected session creation (M2).
 *
 * Behavior (RESEARCH_DOSSIER.md §1, §2):
 *   1. No PAYMENT-SIGNATURE header   → HTTP 402 + PaymentRequired (upto, MAX=$5)
 *   2. Header present + invalid      → HTTP 402 + reason
 *   3. Header present + valid        → call /verify with MAX, then /settle
 *      with ACTUAL=$0.30 (the proxy enforces actual ≤ MAX on-chain)
 *      - settle success              → HTTP 200 { sessionId, paymentTx,
 *                                                 maxAuthorized, settled }
 *      - settle fail after 3 retries → HTTP 402 + reason
 *
 * M2 swaps the M1 `exact` scheme for `upto` on Base Sepolia. The buyer
 * signs a Permit2 witness over `permitted.amount = M2_UPTO_MAX_ATOMIC`
 * ($5); the server then asks the facilitator to settle for
 * `M2_DEMO_SETTLE_ATOMIC` ($0.30). On-chain the x402UptoPermit2Proxy
 * reverts with `AmountExceedsPermitted` if settle.amount > permit.amount,
 * so the asymmetry is enforced by the contract, not by trust. The unspent
 * $4.70 simply never moves — that's the per-second-billing primitive M3
 * will use to charge for actual call duration.
 *
 * `extensions` advertises `eip2612GasSponsoring` so the buyer signs a
 * USDC EIP-2612 permit if Permit2 has zero allowance from this wallet.
 * The facilitator submits permit() + Permit2 transferFrom in one tx,
 * paying gas. We also advertise `erc20ApprovalGasSponsoring` as a fallback
 * for clients that can sign full transactions (CDP can't currently, but
 * doesn't hurt to declare).
 *
 * NOTE: nodejs runtime — Edge runtime breaks the CDP SDK's ed25519 JWT
 * signer (uses Node's crypto module, not Web Crypto).
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
  ACTIVE_CDP_FACILITATOR_ADDRESS,
  ACTIVE_USDC_ADDRESS,
  ACTIVE_USDC_DOMAIN,
  M2_DEMO_SETTLE_ATOMIC,
  M2_DEMO_SETTLE_USD,
  M2_UPTO_MAX_ATOMIC,
  M2_UPTO_MAX_USD,
  UPTO_VALIDITY_SECONDS,
  X402_VERSION,
} from '@/lib/constants';
import { getSellerAddress } from '@/lib/cdp';
import { settleWithRetry, verify } from '@/lib/x402';

export const runtime = 'nodejs';

/**
 * Build the PaymentRequirements for this request. The SAME object (deep-equal)
 * must be used both in the 402 response AND in /verify. For /settle we clone
 * and override `amount` to the actual settlement value — the buyer's signed
 * Permit2 witness allows any settle amount ≤ permitted.amount.
 *
 * `extra.facilitatorAddress` is mandatory for the upto scheme: the witness
 * binds settlement to that address so only the CDP facilitator can call
 * settle() on the x402UptoPermit2Proxy.
 *
 * `extra.name` / `extra.version` carry the USDC EIP-712 domain bits for
 * the EIP-2612 permit the gas-sponsoring extension may sign.
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

/**
 * Build the 402 response body advertising what payment we'll accept. The
 * `extensions` field declares the gas-sponsoring extensions the facilitator
 * supports; the buyer's @x402/evm UptoEvmScheme reads these and signs an
 * EIP-2612 permit (or, fallback, a real ERC-20 approval tx) when the buyer
 * wallet's Permit2 allowance is insufficient.
 */
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
      description: `PayPhone session creation — up to $${M2_UPTO_MAX_USD} USDC on Base Sepolia (M2)`,
      mimeType: 'application/json',
    },
    accepts: [requirements],
    // Each value is a per-extension config object; an empty object is fine
    // because the @x402/evm client only checks for the KEY's presence.
    extensions: {
      eip2612GasSponsoring: {},
      erc20ApprovalGasSponsoring: {},
    },
  };
}

/**
 * Build a 402 NextResponse. The x402 v2 client reads PaymentRequired from
 * the `PAYMENT-REQUIRED` response header (base64 JSON). The JSON body is
 * informational only for v2 (and a fallback for v1 clients).
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
  // VERIFY-time requirements: amount = MAX ($5). The buyer's signature is
  // produced over THIS object's amount; verify checks the EIP-712 hash matches.
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
  const verifyResponse = await verify(paymentPayload, verifyRequirements);
  if (!verifyResponse.isValid) {
    const reason = verifyResponse.invalidReason ?? 'verify rejected';
    const detail = verifyResponse.invalidMessage ?? '';
    return paymentRequiredResponse(
      buildPaymentRequired(resourceUrl, verifyRequirements, `${reason}: ${detail}`.trim()),
    );
  }

  // 2. Settle for the ACTUAL amount ($0.30). Same requirements, only `amount`
  //    differs. The proxy's settle(permit, amount, owner, witness, sig) takes
  //    the on-chain transfer amount as a separate parameter from the signed
  //    permit.permitted.amount — and reverts if amount > permitted.amount.
  //    M3 replaces M2_DEMO_SETTLE_ATOMIC with a duration-derived value.
  const settleRequirements: PaymentRequirements = {
    ...verifyRequirements,
    amount: M2_DEMO_SETTLE_ATOMIC.toString(),
  };
  const settleResponse = await settleWithRetry(paymentPayload, settleRequirements);
  if (!settleResponse.success) {
    const reason = settleResponse.errorReason ?? 'settle failed';
    const detail = settleResponse.errorMessage ?? '';
    return paymentRequiredResponse(
      buildPaymentRequired(resourceUrl, verifyRequirements, `${reason}: ${detail}`.trim()),
    );
  }

  // 3. Payment settled. Return the asymmetry on the wire so the client
  //    can verify on BaseScan that the actual transfer is `settled`, not
  //    `maxAuthorized`. M3 will write the session row to DDB before this
  //    response so a server crash mid-settle doesn't orphan the tx.
  const sessionId = randomUUID();
  return NextResponse.json(
    {
      sessionId,
      paymentTx: settleResponse.transaction,
      maxAuthorized: M2_UPTO_MAX_USD,
      settled: M2_DEMO_SETTLE_USD,
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
