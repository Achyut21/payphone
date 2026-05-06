/**
 * PayPhone — CDP client singleton.
 *
 * `@coinbase/cdp-sdk` reads the three CDP_* env vars from process.env at
 * construction time. We instantiate ONCE per process and reuse the client.
 *
 * Env loading:
 *  - In Next.js API routes / server components, .env.local is auto-loaded by
 *    Next at startup, so no dotenv call is needed here.
 *  - In standalone Node scripts (e.g. scripts/buyer-agent.ts), the script
 *    itself must call dotenv.config({ path: '.env.local' }) BEFORE importing
 *    this module.
 *
 * NEVER read or log the contents of .env.local. The values flow through
 * process.env only — that's the contract.
 */

import { CdpClient } from '@coinbase/cdp-sdk';

const REQUIRED_ENV_VARS = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'CDP_WALLET_SECRET'] as const;

/**
 * Validate that all CDP env vars are present. Throws a descriptive error on
 * any missing var. We don't log values — only the name of the missing key.
 */
function assertCdpEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `CDP env vars missing: ${missing.join(', ')}. ` +
        `Ensure .env.local is present at the project root and contains all three keys.`,
    );
  }
}

let _cdp: CdpClient | null = null;

/**
 * Returns the singleton CdpClient. Lazy: defers env validation until first
 * call so importing this module never throws (matters for tests / type-only
 * imports).
 */
export function getCdp(): CdpClient {
  if (_cdp === null) {
    assertCdpEnv();
    _cdp = new CdpClient();
  }
  return _cdp;
}

/**
 * Resolve the PayPhone buyer wallet. Idempotent — returns the same address
 * across calls and across processes (CDP `getOrCreateAccount` keys on name).
 *
 * Expected address per CONTEXT.md:
 *   0xE01669A01E28E905055Ac6cD33c19ced7e10d870
 */
export async function getBuyerAccount() {
  const cdp = getCdp();
  return cdp.evm.getOrCreateAccount({ name: 'payphone-buyer' });
}

let _sellerAddress: `0x${string}` | null = null;

/**
 * Resolve the PayPhone seller (merchant) wallet. Memoized per process — the
 * first call hits CDP, subsequent calls return the cached address. The
 * `payTo` field of every PaymentRequirements points here, so the facilitator
 * verifies the buyer's witness signature redirected funds to this address.
 *
 * For M1 this is funded via the network's `/settle` and we don't need to
 * touch the seller's funds. For demo / sweep tooling later we can use
 * `cdp.evm.getOrCreateAccount({ name: 'payphone-seller' })` to retrieve.
 */
export async function getSellerAddress(): Promise<`0x${string}`> {
  if (_sellerAddress === null) {
    const cdp = getCdp();
    const account = await cdp.evm.getOrCreateAccount({ name: 'payphone-seller' });
    _sellerAddress = account.address as `0x${string}`;
  }
  return _sellerAddress;
}
