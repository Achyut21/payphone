/**
 * PayPhone — buyer agent (server/CLI-callable).
 *
 * Extracted from `scripts/buyer-agent.ts` so server actions can drive the
 * x402 round-trip too. The CLI script is now a thin wrapper around this
 * module for diagnostic runs.
 *
 * Flow (same as M3, just relocated):
 *   1. Resolve the CDP-managed buyer wallet (idempotent — same address as
 *      M0: 0xE01669A01E28E905055Ac6cD33c19ced7e10d870).
 *   2. Adapt as `ClientEvmSigner` (CDP only exposes `signTypedData`; the
 *      upto scheme uses the `rpcUrl` option to backfill `readContract` /
 *      `getTransactionCount` via viem).
 *   3. POST `{ topic, userId, expertId }` to `${baseUrl}/api/sessions`
 *      via `wrapFetchWithPayment`, which:
 *        a. sees the server's HTTP 402 + PaymentRequirements (scheme=upto,
 *           amount = MAX $5),
 *        b. asks `UptoEvmScheme` to build a Permit2 witness signed over
 *           `permitted.amount = $5`,
 *        c. encodes everything as `PAYMENT-SIGNATURE` and retries.
 *   4. Server creates the Daily room + DDB row (status=AUTHORIZED) and
 *      returns `{ sessionId, roomUrl, ... }`.
 *
 * The recursion gotcha: when called from a server action inside the same
 * Next dev server, this hits the dev server itself over HTTP. That's fine
 * — the route handler doesn't call back into this function — so there's
 * exactly one outer 402 -> sign -> 200 cycle per `requestSession` call.
 *
 * Env: assumes CDP env vars are already loaded (Next handles `.env.local`
 * automatically; the CLI script loads dotenv before importing this).
 *
 * NOT a Client Component module — uses CDP SDK (Node-only). Calling from
 * the browser would fail at bundle time.
 */

import type { ClientEvmSigner } from '@x402/evm';
import { UptoEvmScheme } from '@x402/evm/upto/client';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';

import { ACTIVE_CAIP2, ACTIVE_PUBLIC_RPC_URL } from '@/lib/constants';
import { getUserBuyerAccount } from '@/lib/user-wallet';

/**
 * Minimal CDP-account shape needed to sign the upto witness. Both
 * `getBuyerAccount` (shared dev wallet, used by the diagnostic CLI) and
 * `getUserBuyerAccount` (per-user wallet, used by the marketplace flow)
 * return objects with this surface, so the agent can accept either.
 */
export type AgentBuyer = {
  address: string;
  signTypedData: (params: unknown) => Promise<string>;
};

export type RequestSessionInput = {
  /** Free-text topic; persisted on the row, surfaced into the recap LLM context. */
  topic: string;
  /**
   * The buyer's identity for persistence purposes (stored as `user_id` on
   * the DDB session row). Post-M5 this is a Cognito `sub` for app traffic
   * and a sentinel like `cli-diagnostic` for the CLI.
   *
   * If `buyer` is omitted, the agent looks up the user's CDP wallet via
   * `getUserBuyerAccount(userId)`, so for app traffic this MUST be the
   * Cognito sub.
   */
  userId: string;
  /** Seeded expert id (must match `lib/seed.ts.DEMO_EXPERTS`). */
  expertId: string;
  /**
   * Override the base URL the agent posts to. Defaults to
   * `process.env.INTERNAL_API_URL` (set in Amplify), then `http://localhost:3000`
   * for local dev. Tests can override per-call.
   */
  baseUrl?: string;
  /**
   * Override the buyer's CDP account. When absent, the agent resolves it
   * from `userId` via `getUserBuyerAccount`. The CLI passes its own
   * (shared dev wallet) account here so it doesn't need a real Cognito
   * sub or a DDB user row to run a diagnostic round-trip.
   */
  buyer?: AgentBuyer;
};

export type RequestSessionResult = {
  sessionId: string;
  roomUrl: string;
  /** Display-friendly USD string like `"5.00"` (no `$`). */
  maxAuthorized: string;
  /** Buyer wallet address that signed the permit. */
  payer: string;
  /** CAIP-2 network id, e.g. `"eip155:84532"`. */
  network: string;
  status: string;
};

/**
 * Run the full x402 round-trip and return the M3-shape session response.
 * Throws on non-2xx or malformed responses — server actions can let the
 * Next default error boundary handle these for now.
 */
export async function requestSession(input: RequestSessionInput): Promise<RequestSessionResult> {
  const baseUrl = input.baseUrl ?? process.env.INTERNAL_API_URL ?? 'http://localhost:3000';

  // Resolve the buyer wallet. App traffic flows through getUserBuyerAccount,
  // which looks up the user's row in the payphone-users table (lazy-creating
  // the CDP wallet on first attempt). The CLI / scripts pass their own
  // pre-resolved wallet via `input.buyer` to skip the per-user lookup.
  const buyer = input.buyer ?? (await getUserBuyerAccount(input.userId));

  // Adapter: CDP exposes a viem-compatible signTypedData; UptoEvmScheme
  // backfills readContract / getTransactionCount via the rpcUrl option.
  const signer: ClientEvmSigner = {
    address: buyer.address as `0x${string}`,
    signTypedData: async (params) => {
      // CDP's typed-data param shape is wider than viem's; cast at the boundary.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await buyer.signTypedData(params as any)) as `0x${string}`;
    },
  };

  const client = new x402Client().register(
    ACTIVE_CAIP2,
    new UptoEvmScheme(signer, { rpcUrl: ACTIVE_PUBLIC_RPC_URL }),
  );
  const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);

  const url = `${baseUrl}/api/sessions`;
  const response = await fetchWithPayment(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      topic: input.topic,
      userId: input.userId,
      expertId: input.expertId,
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`requestSession HTTP ${response.status}: ${bodyText}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    throw new Error(`requestSession: non-JSON response: ${bodyText}`);
  }

  if (typeof parsed.sessionId !== 'string' || typeof parsed.roomUrl !== 'string') {
    throw new Error(`requestSession: malformed response: ${bodyText}`);
  }

  return {
    sessionId: parsed.sessionId,
    roomUrl: parsed.roomUrl,
    maxAuthorized: typeof parsed.maxAuthorized === 'string' ? parsed.maxAuthorized : '?',
    payer: typeof parsed.payer === 'string' ? parsed.payer : '?',
    network: typeof parsed.network === 'string' ? parsed.network : '?',
    status: typeof parsed.status === 'string' ? parsed.status : '?',
  };
}
