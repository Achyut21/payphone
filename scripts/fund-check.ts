/**
 * PayPhone — Sepolia balance check + faucet top-up.
 *
 * The buyer wallet was funded with $5 USDC on Base MAINNET in M0, but M1/M2
 * exercises the round-trip on Base SEPOLIA. CDP's faucet provides free
 * Sepolia USDC to any account name, so we use that.
 *
 * Run with:  pnpm tsx scripts/fund-check.ts
 *   --top-up           request faucet USDC if balance is below the target
 *   --target=N         target USDC balance (default: 1). M2 needs >= 5
 *                      because verify simulates a transferFrom of MAX
 *   (default, no flag) just print balances
 *
 * x402's facilitator pays gas on Base, so the buyer doesn't need Sepolia ETH
 * to settle; only USDC matters for our flow. We still print ETH to surface
 * unrelated issues.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createPublicClient, formatUnits, http, erc20Abi } from 'viem';
import { baseSepolia } from 'viem/chains';

import { ACTIVE_USDC_ADDRESS, USDC_DECIMALS } from '../lib/constants';
import { getBuyerAccount, getCdp } from '../lib/cdp';

const DEFAULT_TARGET_USDC = 1; // legacy behavior preserved when no --target given
const TOP_UP_FLAG = process.argv.includes('--top-up');

/** Parse `--target=5` or `--target=5.5` from argv; returns DEFAULT_TARGET_USDC if absent. */
function parseTargetUsdc(): number {
  const flag = process.argv.find((a) => a.startsWith('--target='));
  if (!flag) return DEFAULT_TARGET_USDC;
  const value = Number(flag.split('=')[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --target value: ${flag}`);
  }
  return value;
}

const TARGET_USDC = parseTargetUsdc();

async function main(): Promise<void> {
  const buyer = await getBuyerAccount();
  const address = buyer.address as `0x${string}`;
  console.log(`[fund-check] buyer: ${address}`);
  console.log(`[fund-check] usdc:  ${ACTIVE_USDC_ADDRESS} (Base Sepolia)`);
  console.log(`[fund-check] target: $${TARGET_USDC} USDC`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

  // Read on-chain USDC + ETH balances. Inline (rather than a helper) because
  // typing `publicClient` as a parameter trips over viem's deeply-narrowed
  // generic Client<Transport, Chain, ...> shape.
  const readUsdcAtomic = (): Promise<bigint> =>
    publicClient.readContract({
      address: ACTIVE_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    });

  const [initialUsdcAtomic, initialEthWei] = await Promise.all([
    readUsdcAtomic(),
    publicClient.getBalance({ address }),
  ]);
  const initialUsdc = Number(formatUnits(initialUsdcAtomic, USDC_DECIMALS));
  console.log(`[fund-check] USDC: ${initialUsdc} (${initialUsdcAtomic} atomic)`);
  console.log(`[fund-check] ETH:  ${formatUnits(initialEthWei, 18)}`);

  if (!TOP_UP_FLAG) {
    if (initialUsdc < TARGET_USDC) {
      console.log(
        `[fund-check] balance below $${TARGET_USDC} — re-run with --top-up --target=${TARGET_USDC}`,
      );
    }
    return;
  }

  if (initialUsdc >= TARGET_USDC) {
    console.log(`[fund-check] balance already >= $${TARGET_USDC}, skipping faucet`);
    return;
  }

  // Loop the faucet until target is reached. CDP's Sepolia USDC faucet emits
  // 1 USDC per call (subject to per-account rate limiting), so we may need
  // several calls. Cap iterations defensively to avoid runaway requests if
  // the faucet silently throttles.
  const cdp = getCdp();
  const MAX_ITERATIONS = 20;
  let currentUsdc = initialUsdc;
  let iterations = 0;
  while (currentUsdc < TARGET_USDC && iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(
      `[fund-check] faucet request ${iterations} (current: $${currentUsdc}, target: $${TARGET_USDC})…`,
    );
    const result = await cdp.evm.requestFaucet({
      address,
      network: 'base-sepolia',
      token: 'usdc',
    });
    console.log(`[fund-check]   tx: ${result.transactionHash}`);

    // Wait for the tx to settle so balanceOf reflects the credit. Base Sepolia
    // produces blocks every ~2s; 4s is comfortable headroom.
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const nextAtomic = await readUsdcAtomic();
    currentUsdc = Number(formatUnits(nextAtomic, USDC_DECIMALS));
    console.log(`[fund-check]   USDC now: ${currentUsdc} (${nextAtomic} atomic)`);
  }

  if (currentUsdc < TARGET_USDC) {
    console.error(
      `[fund-check] gave up after ${iterations} iterations — final $${currentUsdc} < target $${TARGET_USDC}`,
    );
    process.exit(1);
  }

  console.log(`[fund-check] reached target after ${iterations} faucet call(s).`);
}

main().catch((err: unknown) => {
  console.error('[fund-check] fatal:', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
