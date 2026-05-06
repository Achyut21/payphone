/**
 * PayPhone — M3 buyer agent.
 *
 * Drives the x402 round-trip with the `upto` scheme, the same way M2 did,
 * but expects an M3-shape response: HTTP 200 with `{ sessionId, roomUrl,
 * maxAuthorized }` and NO settlement yet. Settlement now happens later
 * when the meeting ends and the Daily.co webhook fires.
 *
 *   1. Resolves the CDP-managed buyer wallet (idempotent — same address as
 *      the wallet from M0: 0xE01669A01E28E905055Ac6cD33c19ced7e10d870).
 *   2. Wraps it as an x402 ClientEvmSigner.
 *   3. POSTs to http://localhost:3000/api/sessions via @x402/fetch's
 *      `wrapFetchWithPayment`, which:
 *        a. sees the server's HTTP 402 + PaymentRequirements (scheme=upto,
 *           amount = MAX $5, extensions: eip2612GasSponsoring +
 *           erc20ApprovalGasSponsoring),
 *        b. asks UptoEvmScheme to build a Permit2 witness payload signed
 *           over `permitted.amount = $5`,
 *        c. if Permit2 has zero allowance from this wallet AND the server
 *           declared eip2612GasSponsoring, the scheme additionally signs
 *           a USDC EIP-2612 permit so the facilitator can perform the
 *           one-time approve gaslessly,
 *        d. encodes everything as PAYMENT-SIGNATURE and retries the request.
 *   4. Server creates the Daily room + DDB row (status=AUTHORIZED) and
 *      returns the room URL. The buyer agent prints it prominently and
 *      exits — joining the room and ending the call is a manual step
 *      until M4.
 *
 * Run with:  pnpm tsx scripts/buyer-agent.ts
 *
 * Flip `SERVER_URL` env var to hit a different host. Defaults to localhost.
 */

import dotenv from 'dotenv';
// .env.local must be loaded before any function below reads CDP env vars.
// (The imports themselves are side-effect-free re: env, so import-hoisting is
// not a problem here — env is only read inside function bodies at call time.)
dotenv.config({ path: '.env.local' });

import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { UptoEvmScheme } from '@x402/evm/upto/client';
import type { ClientEvmSigner } from '@x402/evm';

import { ACTIVE_CAIP2, ACTIVE_NETWORK, ACTIVE_PUBLIC_RPC_URL } from '../lib/constants';
import { getBuyerAccount } from '../lib/cdp';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3000';

async function main(): Promise<void> {
  console.log(`[buyer-agent] resolving CDP buyer wallet…`);
  const buyer = await getBuyerAccount();
  console.log(`[buyer-agent] wallet: ${buyer.address}`);
  console.log(`[buyer-agent] network: ${ACTIVE_NETWORK} (${ACTIVE_CAIP2})`);

  // Adapter: the buyer EvmAccount exposes a viem-compatible signTypedData; we
  // retype it to ClientEvmSigner's wider parameter shape so the x402 scheme
  // accepts it. CDP doesn't expose readContract / signTransaction directly,
  // but UptoEvmScheme's `options.rpcUrl` lets it backfill those via viem.
  const signer: ClientEvmSigner = {
    address: buyer.address as `0x${string}`,
    signTypedData: async (params) => {
      // The x402 scheme assembles the EIP-712 typed data; CDP just signs it.
      // Cast widens our generic shape to viem's stricter parameter type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await buyer.signTypedData(params as any)) as `0x${string}`;
    },
  };

  // The upto scheme needs an RPC URL so its gas-sponsoring extensions can:
  //   - read Permit2 allowance to decide if a permit/approval is needed
  //   - read EIP-2612 nonce(owner) to build the permit
  // If allowance is already sufficient (e.g. from a prior approval) the
  // extensions short-circuit and no extra signing happens.
  const client = new x402Client().register(
    ACTIVE_CAIP2,
    new UptoEvmScheme(signer, { rpcUrl: ACTIVE_PUBLIC_RPC_URL }),
  );
  const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);

  const url = `${SERVER_URL}/api/sessions`;
  console.log(`[buyer-agent] POST ${url}`);

  const response = await fetchWithPayment(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: 'M3 video session test' }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    console.error(`[buyer-agent] HTTP ${response.status}: ${bodyText}`);
    process.exit(1);
  }

  let body: {
    sessionId?: string;
    roomUrl?: string;
    maxAuthorized?: string;
    payer?: string;
    network?: string;
    status?: string;
  };
  try {
    body = JSON.parse(bodyText);
  } catch {
    console.error(`[buyer-agent] non-JSON success response: ${bodyText}`);
    process.exit(1);
  }

  console.log(`[buyer-agent] HTTP 200 OK`);
  console.log(`[buyer-agent]   sessionId:     ${body.sessionId}`);
  console.log(`[buyer-agent]   maxAuthorized: $${body.maxAuthorized ?? '(unknown)'}`);
  console.log(`[buyer-agent]   status:        ${body.status ?? '(unknown)'}`);
  console.log(`[buyer-agent]   payer:         ${body.payer ?? '(unknown)'}`);
  console.log(`[buyer-agent]   network:       ${body.network ?? '(unknown)'}`);

  if (body.roomUrl) {
    console.log('');
    console.log('🎥 Open this URL in TWO browser tabs to test M3 settlement:');
    console.log('');
    console.log(`   ${body.roomUrl}`);
    console.log('');
    console.log('   Talk for ~30–60 seconds, then click "Leave" in either tab.');
    console.log('   Daily will fire `meeting.ended` to /api/webhooks/daily,');
    console.log('   which will compute duration × rate, settle on-chain, and');
    console.log('   mark the DDB row COMPLETED.');
    console.log('');
    if (body.sessionId) {
      console.log('🔍 After hangup, inspect the final state with:');
      console.log('');
      console.log(`   pnpm tsx scripts/inspect-session.ts ${body.sessionId}`);
      console.log('');
    }
  }
}

main().catch((err: unknown) => {
  console.error('[buyer-agent] fatal:', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
