/**
 * GET /api/users/me/balance — return the authenticated user's wallet
 * address + USDC balance on the active network (M5 Phase 5).
 *
 * Used by the marketplace's wallet panel to render live balance and
 * decide whether to show the "Fund my wallet" button.
 *
 * Reads via a public RPC for simplicity. The amount is returned as
 * BOTH the atomic bigint (string-encoded for JSON safety) and a
 * pre-formatted USD string so the client doesn't have to know about
 * USDC decimals.
 *
 * `runtime = 'nodejs'` per CONTEXT.md — viem's createPublicClient pulls
 * in `crypto` which Edge can't host.
 */

import { NextResponse } from 'next/server';
import { createPublicClient, http, erc20Abi, formatUnits } from 'viem';
import { base, baseSepolia } from 'viem/chains';

import { getCurrentUser } from '@/lib/auth';
import {
  ACTIVE_NETWORK,
  ACTIVE_PUBLIC_RPC_URL,
  ACTIVE_USDC_ADDRESS,
  USDC_DECIMALS,
} from '@/lib/constants';
import { getOrCreateUserWallet } from '@/lib/user-wallet';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const row = await getOrCreateUserWallet(user.id);
  const address = row.cdp_wallet_address;

  // viem's chain object is needed for type-narrowing on the public client;
  // the actual RPC call uses ACTIVE_PUBLIC_RPC_URL via http(...).
  const chain = ACTIVE_NETWORK === 'mainnet' ? base : baseSepolia;
  const client = createPublicClient({ chain, transport: http(ACTIVE_PUBLIC_RPC_URL) });

  let balanceAtomic: bigint;
  try {
    balanceAtomic = await client.readContract({
      address: ACTIVE_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown rpc error';
    console.error('[balance] readContract failed:', message);
    return NextResponse.json(
      { error: 'rpc_unavailable', message: 'Could not read on-chain balance.', detail: message },
      { status: 502 },
    );
  }

  return NextResponse.json({
    address,
    network: ACTIVE_NETWORK,
    /** Atomic units as a string for JSON safety (bigint isn't JSON-serializable). */
    balanceAtomic: balanceAtomic.toString(),
    /** Pre-formatted, e.g. "12.345678". */
    balanceUsd: formatUnits(balanceAtomic, USDC_DECIMALS),
  });
}
