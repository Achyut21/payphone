/**
 * PayPhone — one-time migration: link a Cognito user to the M0 dev wallet.
 *
 * Run AFTER you've signed up via Cognito with the email you want to use
 * for the demo. The script writes a row to `payphone-users` mapping
 * your Cognito `sub` to the EXISTING shared wallet (the M0-funded
 * `payphone-buyer` account at `0xE01669A01E28E905055Ac6cD33c19ced7e10d870`),
 * so subsequent `getOrCreateUserWallet(cognito_sub)` calls return the
 * funded wallet instead of provisioning a fresh empty one.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-achyut.ts <cognito_sub>
 *
 * How to find your Cognito sub:
 *   - Sign in to PayPhone in the browser (`/login` → Cognito Hosted UI).
 *   - Visit `http://localhost:3000/api/auth/session` while signed in.
 *   - Copy the `user.id` field (UUID-like, e.g. `a4f8…-c9d2`).
 *
 * Idempotency: the DDB write is conditional on `attribute_not_exists`,
 * so re-running with the same sub fails cleanly. To intentionally
 * re-link (e.g. after deleting and recreating the Cognito user), delete
 * the existing row first via the AWS Console or `aws dynamodb delete-item`.
 *
 * Why this exists: the M0–M4.9 dev wallet has $5 mainnet USDC + ~$20
 * Sepolia USDC. Phase 5 adds a faucet button for new users, but for the
 * stage demo we want Achyut's account to use the existing funded wallet
 * (no faucet needed, no surprise on stage).
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { PutCommand } from '@aws-sdk/lib-dynamodb';

import { getDoc } from '../lib/db';

/** The M0 buyer wallet — name is the CDP account label, address for sanity log. */
const SHARED_DEV_WALLET_NAME = 'payphone-buyer';
const SHARED_DEV_WALLET_ADDRESS = '0xE01669A01E28E905055Ac6cD33c19ced7e10d870' as const;

async function main(): Promise<void> {
  const cognito_sub = process.argv[2];
  if (!cognito_sub) {
    console.error('Usage: pnpm tsx scripts/migrate-achyut.ts <cognito_sub>');
    console.error('');
    console.error('How to find your sub: sign in via /login, then visit');
    console.error('http://localhost:3000/api/auth/session and copy `user.id`.');
    process.exit(1);
  }

  const table = process.env.USERS_TABLE_NAME;
  if (!table) {
    console.error('USERS_TABLE_NAME env var missing. Add to .env.local first.');
    process.exit(1);
  }

  console.log(`[migrate-achyut] linking cognito_sub=${cognito_sub}`);
  console.log(`[migrate-achyut]   → wallet name: ${SHARED_DEV_WALLET_NAME}`);
  console.log(`[migrate-achyut]   → wallet addr: ${SHARED_DEV_WALLET_ADDRESS}`);
  console.log(`[migrate-achyut]   → table: ${table}`);

  try {
    await getDoc().send(
      new PutCommand({
        TableName: table,
        Item: {
          cognito_sub,
          cdp_wallet_address: SHARED_DEV_WALLET_ADDRESS,
          cdp_wallet_name: SHARED_DEV_WALLET_NAME,
          created_at: Date.now(),
          // Flag this row as the dev/legacy account. Useful for
          // analytics and for confirming a row is intentional rather
          // than an accidental overwrite.
          is_dev_account: true,
        },
        ConditionExpression: 'attribute_not_exists(cognito_sub)',
      }),
    );
    console.log(`[migrate-achyut] ✅ migration row written`);
    console.log('');
    console.log('Next: open `/marketplace` (signed in as the same Cognito');
    console.log('user) and click any expert. The session should sign from');
    console.log(`${SHARED_DEV_WALLET_ADDRESS} — confirmed via the `);
    console.log('"payer" field in the buyer-agent log or the BaseScan tx.');
  } catch (err: unknown) {
    const errObj = err as { name?: string; message?: string };
    if (errObj.name === 'ConditionalCheckFailedException') {
      console.error('');
      console.error(`[migrate-achyut] ❌ a row for cognito_sub=${cognito_sub} already exists.`);
      console.error('');
      console.error('To intentionally re-link, delete the existing row first:');
      console.error('  AWS Console → DynamoDB → payphone-users → delete the matching item');
      console.error('  ...or via CLI: aws dynamodb delete-item --table-name payphone-users \\');
      console.error(`    --key '{"cognito_sub":{"S":"${cognito_sub}"}}'`);
      process.exit(2);
    }
    console.error('[migrate-achyut] fatal:', errObj.message ?? err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('[migrate-achyut] unexpected:', err);
  process.exit(1);
});
