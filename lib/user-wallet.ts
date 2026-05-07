/**
 * PayPhone — per-user CDP wallet provisioning (M5).
 *
 * Each authenticated user gets their own CDP Server Wallet, lazily
 * created on their first session attempt (NOT at signup, per the
 * architectural decision in the M5 brief). The buyer-side x402 signing
 * for `/api/sessions` uses this wallet, replacing the M0–M4.9 shared
 * `payphone-buyer` wallet.
 *
 * Two stores are involved:
 *   1. CDP — owns the actual wallet (private key, signing capabilities).
 *      Idempotent on `name`: `getOrCreateAccount({ name })` always
 *      returns the same address for the same name.
 *   2. DDB `payphone-users` — owns the mapping (cognito_sub →
 *      cdp_wallet_name). Necessary because:
 *        a. The wallet NAME may differ from the natural
 *           `payphone-user-<sub>` for legacy / migrated accounts (see
 *           Phase 4 — the original Achyut wallet is `payphone-buyer`).
 *        b. We need a list of "all users we've provisioned" without
 *           polling CDP, e.g. for analytics.
 *
 * Lazy creation rationale (architectural decision #2 in M5 brief):
 *   - Cognito signup → CDP create are independent network calls. Coupling
 *     them would mean a CDP outage breaks signup entirely.
 *   - Most signups don't result in a session. Lazy creation saves CDP quota.
 *   - Failure on first attempt is recoverable: retry on next session click.
 *
 * Concurrency:
 *   - Two simultaneous "first session" requests from the same user race.
 *     CDP's `getOrCreateAccount` is idempotent so both end up with the
 *     same address. DDB's conditional Put ensures only ONE row gets
 *     written; the loser re-reads the row that the winner wrote.
 */

import 'server-only';

import { createHash } from 'node:crypto';

import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { getCdp } from './cdp';
import { getDoc } from './db';

/** Resolved at use time so missing env throws a clear error. */
function getUsersTable(): string {
  const name = process.env.USERS_TABLE_NAME;
  if (!name) {
    throw new Error(
      'USERS_TABLE_NAME env var missing. Run `terraform output -raw users_table_name` ' +
        'from infra/terraform and add to .env.local.',
    );
  }
  return name;
}

/**
 * Build a CDP-valid wallet name from a Cognito sub.
 *
 * Constraints (per CDP API):
 *   - Alphanumeric + hyphens only
 *   - Length 2..=36 characters
 *
 * Cognito subs are 36-char UUIDs. The natural `payphone-user-<sub>` is
 * 50 chars, which CDP rejects with a 400. We instead hash the sub to
 * 16 hex chars and prefix `payphone-`, producing a deterministic 25-
 * character name (`payphone-` (9) + `[a-f0-9]{16}` (16)). Same sub
 * always maps to the same name, so CDP's `getOrCreateAccount` stays
 * idempotent.
 *
 * Collision math: 16 hex chars = 64 bits. Birthday-paradox collision
 * at ~4 billion accounts. Way safer than we need at hackathon scale.
 */
function walletNameFor(cognito_sub: string): string {
  const hash = createHash('sha256').update(cognito_sub).digest('hex').slice(0, 16);
  return `payphone-${hash}`;
}

export type UserWalletRow = {
  /** Cognito `sub` — primary key. */
  cognito_sub: string;
  /** EVM address, lowercase 0x-prefixed (CDP's canonical format). */
  cdp_wallet_address: `0x${string}`;
  /**
   * CDP account name. For new users, a deterministic 25-char name
   * derived from `walletNameFor(cognito_sub)` (`payphone-` + 16 hex
   * chars of SHA-256). The legacy `payphone-buyer` value is reserved
   * for the Achyut migration row that points at the M0-funded wallet.
   */
  cdp_wallet_name: string;
  /** Unix ms. */
  created_at: number;
  /**
   * Set true by `scripts/migrate-achyut.ts` to flag the dev/legacy
   * account whose row points at the M0-funded shared wallet. Useful for
   * filtering analytics or confirming a row is intentional rather than
   * an accidental overwrite. Optional / absent on regular users.
   */
  is_dev_account?: boolean;
};

/**
 * Resolve (and lazily create) the wallet row for a Cognito-authenticated
 * user. Always returns a row — never null. On miss, creates the CDP
 * wallet first (so a DDB write only happens after CDP confirms success)
 * then conditionally writes the DDB row.
 *
 * The race-loser path (a concurrent first-attempt won the conditional
 * write) re-reads the table to return the row written by the winner —
 * the address itself is identical because of CDP idempotency.
 */
export async function getOrCreateUserWallet(cognito_sub: string): Promise<UserWalletRow> {
  const table = getUsersTable();
  const doc = getDoc();

  // Fast path: existing row.
  const existing = await doc.send(new GetCommand({ TableName: table, Key: { cognito_sub } }));
  if (existing.Item?.cdp_wallet_address) {
    return existing.Item as UserWalletRow;
  }

  // Lazy path: create CDP wallet first, then persist mapping.
  const wallet_name = walletNameFor(cognito_sub);
  const cdp = getCdp();
  const account = await cdp.evm.getOrCreateAccount({ name: wallet_name });

  const row: UserWalletRow = {
    cognito_sub,
    cdp_wallet_address: account.address as `0x${string}`,
    cdp_wallet_name: wallet_name,
    created_at: Date.now(),
  };

  try {
    await doc.send(
      new PutCommand({
        TableName: table,
        Item: row,
        ConditionExpression: 'attribute_not_exists(cognito_sub)',
      }),
    );
    return row;
  } catch (err) {
    // Race: another request beat us. Re-read and return the winner's row.
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      const reread = await doc.send(new GetCommand({ TableName: table, Key: { cognito_sub } }));
      if (reread.Item) return reread.Item as UserWalletRow;
    }
    throw err;
  }
}

/**
 * Resolve the CDP `Account` (the signing-capable handle) for a user.
 * Looks up the wallet name in DDB first, then asks CDP. The CDP call is
 * idempotent — same name always returns the same address — so this is
 * safe to call repeatedly and is the canonical entry point for the
 * x402 signing path.
 */
export async function getUserBuyerAccount(cognito_sub: string) {
  const row = await getOrCreateUserWallet(cognito_sub);
  return getCdp().evm.getOrCreateAccount({ name: row.cdp_wallet_name });
}
