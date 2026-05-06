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

/** BaseScan tx URL prefix — derived from active network. */
const BASESCAN_TX_BASE_URLS = {
  mainnet: 'https://basescan.org/tx/',
  sepolia: 'https://sepolia.basescan.org/tx/',
} as const;

export const BASESCAN_TX_BASE_URL: string = BASESCAN_TX_BASE_URLS[ACTIVE_NETWORK];
