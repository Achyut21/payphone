import { CdpClient } from '@coinbase/cdp-sdk';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  // Sanity check: all three env vars must be present
  const required = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'CDP_WALLET_SECRET'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`X Missing ${key} in .env.local`);
      process.exit(1);
    }
  }

  const cdp = new CdpClient(); // automatically reads CDP_* env vars

  // getOrCreateAccount: idempotent — running this twice returns the SAME wallet
  const account = await cdp.evm.getOrCreateAccount({ name: 'payphone-buyer' });

  console.log('\nCDP buyer wallet ready');
  console.log('------------------------------------------------------------');
  console.log(`Address:  ${account.address}`);
  console.log(`Name:     payphone-buyer`);
  console.log('------------------------------------------------------------');
  console.log('\nNext steps:');
  console.log('1. Send this address to your teammate for the $5 USDC test');
  console.log('2. Network: Base (NOT Ethereum, NOT Solana)');
  console.log(`3. Verify on BaseScan: https://basescan.org/address/${account.address}`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message ?? err);
  process.exit(1);
});
