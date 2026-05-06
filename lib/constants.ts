/**
 * PayPhone — chain & contract constants.
 *
 * This is the SINGLE source of truth for addresses, chain ids, and protocol
 * URLs across the app. Do NOT inline any of these values elsewhere; import
 * from here so the M5 mainnet flip is one variable change (`ACTIVE_NETWORK`).
 *
 * References: docs/RESEARCH_DOSSIER.md §3.
 */

export const USDC_ADDRESS = {
  mainnet: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  sepolia: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
} as const;

/**
 * EIP-712 domain components for USDC. Values DIFFER between mainnet and
 * Sepolia — getting either wrong silently produces a signature that the
 * facilitator's on-chain `staticcall` check rejects with a revert.
 *
 * Mainnet (Circle production): name = "USD Coin"
 * Sepolia (Circle testnet):    name = "USDC"
 *
 * Verified empirically against on-chain `name()` of each contract.
 */
export const USDC_DOMAIN = {
  mainnet: { name: 'USD Coin', version: '2' },
  sepolia: { name: 'USDC', version: '2' },
} as const;

export const CHAIN_ID = { mainnet: 8453, sepolia: 84532 } as const;

/** CAIP-2 network identifiers used by the x402 client/server. */
export const CAIP2 = { mainnet: 'eip155:8453', sepolia: 'eip155:84532' } as const;

/** Canonical Permit2 contract address — same on every EVM chain via CREATE2. */
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;

/** x402 ExactPermit2Proxy — also the same address on every EVM chain. */
export const X402_PROXY = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001' as const;

/** Coinbase CDP x402 Facilitator base URL (verify + settle). */
export const FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402' as const;

/**
 * Network selector. M1–M4 use Sepolia for safe iteration; M5 flips to mainnet
 * for the live demo. Flip exactly this constant; everything below derives.
 */
export const ACTIVE_NETWORK = 'sepolia' as const;

export const ACTIVE_CHAIN_ID = CHAIN_ID[ACTIVE_NETWORK];
export const ACTIVE_USDC_ADDRESS = USDC_ADDRESS[ACTIVE_NETWORK];
export const ACTIVE_CAIP2 = CAIP2[ACTIVE_NETWORK];
export const ACTIVE_USDC_DOMAIN = USDC_DOMAIN[ACTIVE_NETWORK];

/**
 * x402 protocol version we negotiate with. The CDP facilitator currently
 * supports both 1 and 2; the `upto` scheme requires v2.
 */
export const X402_VERSION = 2 as const;

/**
 * USDC has 6 decimals on Base (and on every chain Circle deploys to). All
 * billing math runs in atomic units (1e6 = 1 USDC); we only format on render.
 */
export const USDC_DECIMALS = 6 as const;

/** $0.10 in USDC atomic units = 100_000. M1 hardcodes this; M2 makes it dynamic. */
export const M1_PRICE_ATOMIC = 100_000n;

/** Human-readable price string for PaymentRequirements.maxAmountRequired display. */
export const M1_PRICE_USD = '0.10' as const;

/**
 * M2 — `upto` scheme amounts on Base Sepolia.
 *
 * The buyer signs a Permit2 witness for `M2_UPTO_MAX_ATOMIC`; the server
 * then settles for any value ≤ MAX via the x402UptoPermit2Proxy contract,
 * which reverts on `amount > permitted.amount` (`AmountExceedsPermitted`).
 * M2 hardcodes the settle amount to demonstrate the asymmetry; M3 will
 * derive it from the Daily.co call duration.
 */
export const M2_UPTO_MAX_ATOMIC = 5_000_000n;
export const M2_UPTO_MAX_USD = '5.00' as const;

/** M2 hardcoded settle amount: $0.30 USDC. M3 replaces this with duration-derived. */
export const M2_DEMO_SETTLE_ATOMIC = 300_000n;
export const M2_DEMO_SETTLE_USD = '0.30' as const;

/**
 * Authorization deadline window for the upto Permit2 witness: 30 minutes.
 * The signed `deadline = now + UPTO_VALIDITY_SECONDS`. Past this point the
 * signature is unusable and the unspent allowance simply expires on-chain.
 * M3 may shorten this to match the actual Daily.co session window.
 */
export const UPTO_VALIDITY_SECONDS = 30 * 60;

/**
 * Coinbase CDP facilitator's on-chain settle signer addresses (per network).
 * The upto scheme bakes this into the witness as the only address allowed
 * to call `settle()` on the proxy. Sourced empirically from
 * `getSupported().kinds[scheme=upto].extra.facilitatorAddress`.
 *
 * Hardcoded for reliability: avoids an extra round-trip to /supported on
 * every request. If CDP rotates the facilitator signer, this constant
 * needs to flip — re-run `scripts/probe-supported.ts` to confirm.
 */
export const CDP_FACILITATOR_ADDRESS = {
  mainnet: '0x8F5cB67B49555E614892b7233CFdDEBFB746E531',
  sepolia: '0x8F5cB67B49555E614892b7233CFdDEBFB746E531',
} as const;

export const ACTIVE_CDP_FACILITATOR_ADDRESS: `0x${string}` =
  CDP_FACILITATOR_ADDRESS[ACTIVE_NETWORK];

/**
 * Public RPC endpoint used by the BUYER-side scheme to backfill optional
 * capabilities (`readContract` for Permit2 allowance + EIP-2612 nonce reads,
 * `getTransactionCount` / `estimateFeesPerGas` for the ERC-20 approval
 * fallback). The CDP signer doesn't expose these directly; the @x402/evm
 * scheme falls back to viem's createPublicClient when an rpcUrl is provided.
 *
 * Server-side never reads from these — verify/settle go through CDP.
 */
export const PUBLIC_RPC_URL = {
  mainnet: 'https://mainnet.base.org',
  sepolia: 'https://sepolia.base.org',
} as const;

export const ACTIVE_PUBLIC_RPC_URL: string = PUBLIC_RPC_URL[ACTIVE_NETWORK];

/** BaseScan tx URL prefix — derived from active network. */
const BASESCAN_TX_BASE_URLS = {
  mainnet: 'https://basescan.org/tx/',
  sepolia: 'https://sepolia.basescan.org/tx/',
} as const;

export const BASESCAN_TX_BASE_URL: string = BASESCAN_TX_BASE_URLS[ACTIVE_NETWORK];

/**
 * M3 — duration-derived per-second billing.
 *
 * The buyer's upto witness authorizes up to `M2_UPTO_MAX_ATOMIC` ($5). At
 * meeting hangup the Daily webhook reports `duration_sec`; we settle for
 * `duration_sec × M3_PER_SECOND_RATE_ATOMIC`, capped at the upto MAX. This
 * is the per-second-billing primitive M2 set up the rails for.
 *
 * Rate: $0.01/sec = 10_000 atomic units. Matches the demo line "$0.10 every
 * 10 seconds" — round numbers on stage are easier to follow than a more
 * realistic rate like $2/min would be.
 */
export const M3_PER_SECOND_RATE_ATOMIC = 10_000n;

/**
 * Compute the on-chain settle amount in USDC atomic units from a call
 * duration in seconds. Floors to whole seconds and clamps the lower bound
 * to 0 (defensive — if Daily ever sends a negative or NaN duration we
 * settle for $0 rather than a negative permit overflow). Clamps the upper
 * bound to `M2_UPTO_MAX_ATOMIC` ($5) — beyond that the on-chain proxy
 * would revert with `AmountExceedsPermitted` anyway, but capping here
 * gives us a clean settle instead of a failed retry loop.
 */
export function computeSettleAmount(durationSec: number): bigint {
  const seconds = Number.isFinite(durationSec) ? Math.max(0, Math.floor(durationSec)) : 0;
  const raw = BigInt(seconds) * M3_PER_SECOND_RATE_ATOMIC;
  return raw > M2_UPTO_MAX_ATOMIC ? M2_UPTO_MAX_ATOMIC : raw;
}

/**
 * Daily room expiration window: 30 minutes from creation. Same value as
 * `UPTO_VALIDITY_SECONDS` by design — the room cannot outlive the buyer's
 * Permit2 authorization, otherwise a guest could keep the call running
 * past the deadline and we'd have an unsettleable session. They're kept
 * as separate constants for conceptual clarity (one bounds chain state,
 * the other bounds Daily room state) even though they happen to share
 * a numeric value today.
 */
export const DAILY_ROOM_TTL_SECONDS = 30 * 60;
