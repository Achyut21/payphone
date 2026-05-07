/**
 * POST /api/users/me/faucet — drip Sepolia USDC into the authenticated
 * user's wallet (M5 Phase 5).
 *
 * Flow:
 *   1. Cognito session required. 401 otherwise.
 *   2. Resolve (or lazy-create) the user's CDP wallet.
 *   3. Call CDP's testnet faucet for 10 USDC on Base Sepolia.
 *   4. On rate-limit / quota errors, return 503 + a fallback link to
 *      Circle's official faucet so the user has a recovery path.
 *
 * Mainnet guard: the CDP faucet is testnet-only by design — mainnet
 * USDC has actual cost. We refuse the request when ACTIVE_NETWORK is
 * mainnet (M6 dress rehearsal / on-stage configuration). The marketplace
 * UI also hides the button on mainnet so this branch is defense-in-depth.
 *
 * `runtime = 'nodejs'` per CONTEXT.md for any route touching CDP.
 */

import { NextResponse } from 'next/server';

import { getCdp } from '@/lib/cdp';
import { ACTIVE_NETWORK } from '@/lib/constants';
import { getCurrentUser } from '@/lib/auth';
import { getOrCreateUserWallet } from '@/lib/user-wallet';

export const runtime = 'nodejs';

/** Public Circle faucet — manual fallback when CDP rate-limits us. */
const CIRCLE_FAUCET_URL = 'https://faucet.circle.com/';

export async function POST(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  if (ACTIVE_NETWORK === 'mainnet') {
    return NextResponse.json(
      { error: 'faucet_unavailable_on_mainnet', message: 'Faucet is only available on Sepolia.' },
      { status: 400 },
    );
  }

  const row = await getOrCreateUserWallet(user.id);
  const address = row.cdp_wallet_address;

  try {
    const result = await getCdp().evm.requestFaucet({
      address,
      network: 'base-sepolia',
      token: 'usdc',
    });
    return NextResponse.json({
      ok: true,
      address,
      txHash: result.transactionHash,
      message: '10 Sepolia USDC dripped',
    });
  } catch (err) {
    // Most likely cause: CDP project-level rate limit hit (24h rolling
    // window). Surface a readable message + the manual fallback link
    // so the user is unblocked without us needing to log into AWS.
    const message = err instanceof Error ? err.message : 'unknown faucet error';
    console.error('[faucet] CDP requestFaucet failed:', message);
    return NextResponse.json(
      {
        ok: false,
        address,
        message: "CDP faucet rate-limit reached (24h rolling). Use Circle's faucet manually:",
        fallback_url: CIRCLE_FAUCET_URL,
        detail: message,
      },
      { status: 503 },
    );
  }
}
