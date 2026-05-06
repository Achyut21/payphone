/**
 * PayPhone — Sepolia balance check + faucet top-up.
 *
 * The buyer wallet was funded with $5 USDC on Base MAINNET in M0, but M1
 * exercises the round-trip on Base SEPOLIA. CDP's faucet provides free
 * Sepolia USDC to any account name, so we use that.
 *
 * Run with:  pnpm tsx scripts/fund-check.ts
 *   --top-up   request faucet USDC if balance < $1
 *   (default)  just print balances
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

const TOP_UP_THRESHOLD_USDC = 1; // request faucet if USDC balance is below this
const TOP_UP_FLAG = process.argv.includes('--top-up');

async function main(): Promise<void> {
  const buyer = await getBuyerAccount();
  const address = buyer.address as `0x${string}`;
  console.log(`[fund-check] buyer: ${address}`);
  console.log(`[fund-check] usdc:  ${ACTIVE_USDC_ADDRESS} (Base Sepolia)`);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

  const [usdcRaw, ethRaw] = await Promise.all([
    publicClient.readContract({
      address: ACTIVE_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    }),
    publicClient.getBalance({ address }),
  ]);

  const usdc = Number(formatUnits(usdcRaw, USDC_DECIMALS));
  const eth = formatUnits(ethRaw, 18);

  console.log(`[fund-check] USDC: ${usdc} (${usdcRaw} atomic)`);
  console.log(`[fund-check] ETH:  ${eth}`);

  if (!TOP_UP_FLAG) {
    if (usdc < TOP_UP_THRESHOLD_USDC) {
      console.log(`[fund-check] balance below $${TOP_UP_THRESHOLD_USDC} — re-run with --top-up`);
    }
    return;
  }

  if (usdc >= TOP_UP_THRESHOLD_USDC) {
    console.log(`[fund-check] balance already >= $${TOP_UP_THRESHOLD_USDC}, skipping faucet`);
    return;
  }

  console.log(`[fund-check] requesting Sepolia USDC from CDP faucet…`);
  const cdp = getCdp();
  const result = await cdp.evm.requestFaucet({
    address,
    network: 'base-sepolia',
    token: 'usdc',
  });
  console.log(`[fund-check] faucet tx: ${result.transactionHash}`);
  console.log(`[fund-check] BaseScan:  https://sepolia.basescan.org/tx/${result.transactionHash}`);
  console.log(
    `[fund-check] note: faucet credits arrive after 1-2 blocks (~4 sec on Base Sepolia).`,
  );
}

main().catch((err: unknown) => {
  console.error('[fund-check] fatal:', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
