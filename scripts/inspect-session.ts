/**
 * scripts/inspect-session.ts — print a session row from DDB by id.
 *
 *   pnpm tsx scripts/inspect-session.ts <sessionId>
 *
 * Used to verify M3 settle ran end-to-end:
 *   - status flipped from AUTHORIZED to COMPLETED
 *   - settled_amount matches duration_sec × M3_PER_SECOND_RATE_ATOMIC
 *   - settle_tx_hash is set, and BaseScan URL is printed for visual check
 *
 * Also useful for ad-hoc debugging: any session id, any status. The
 * script never modifies DDB — read-only.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { BASESCAN_TX_BASE_URL, M3_PER_SECOND_RATE_ATOMIC } from '../lib/constants';
import { getSession } from '../lib/db';

function formatUsdc(atomic: number | undefined): string {
  if (atomic === undefined) return '(unset)';
  return `$${(atomic / 1_000_000).toFixed(6)} (${atomic} atomic)`;
}

function formatTs(ts: number | undefined): string {
  if (ts === undefined) return '(unset)';
  const date = new Date(ts * 1000);
  return `${ts} (${date.toISOString()})`;
}

async function main(): Promise<void> {
  const sessionId = process.argv[2];
  if (!sessionId || sessionId.startsWith('-')) {
    console.error('Usage: pnpm tsx scripts/inspect-session.ts <sessionId>');
    process.exit(1);
  }

  const session = await getSession(sessionId);
  if (!session) {
    console.error(`[inspect-session] no session found for id=${sessionId}`);
    process.exit(1);
  }

  console.log(`[inspect-session] session_id: ${session.session_id}`);
  console.log(`  status:                       ${session.status}`);
  console.log(`  agent_wallet_addr (buyer):    ${session.agent_wallet_addr}`);
  console.log(`  user_id:                      ${session.user_id}`);
  console.log(`  expert_id:                    ${session.expert_id}`);
  console.log(`  video_room_id:                ${session.video_room_id}`);
  console.log(`  video_room_url:               ${session.video_room_url}`);
  console.log(`  started_at:                   ${formatTs(session.started_at)}`);
  console.log(`  ended_at:                     ${formatTs(session.ended_at)}`);
  console.log(`  expires_at (ttl):             ${formatTs(session.expires_at)}`);
  console.log(`  duration_sec:                 ${session.duration_sec ?? '(unset)'}`);
  console.log(`  max_authorized_amount:        ${formatUsdc(session.max_authorized_amount)}`);
  console.log(`  settled_amount:               ${formatUsdc(session.settled_amount)}`);
  console.log(`  settle_tx_hash:               ${session.settle_tx_hash ?? '(unset)'}`);
  console.log(
    `  payment_authorization_payload: ${
      session.payment_authorization_payload
        ? `(${session.payment_authorization_payload.length} chars base64)`
        : '(unset)'
    }`,
  );

  if (session.settle_tx_hash) {
    console.log('');
    console.log(`  BaseScan: ${BASESCAN_TX_BASE_URL}${session.settle_tx_hash}`);
  }

  // Sanity: re-derive the expected amount and flag any discrepancy. Helps
  // catch off-by-one or unit-conversion bugs at a glance. Daily reports
  // duration as a float (e.g. 88.36s); we floor it to match what
  // computeSettleAmount() does at settle time.
  if (session.duration_sec !== undefined && session.settled_amount !== undefined) {
    const flooredDuration = Math.max(0, Math.floor(session.duration_sec));
    const expected = BigInt(flooredDuration) * M3_PER_SECOND_RATE_ATOMIC;
    const actual = BigInt(session.settled_amount);
    if (expected !== actual) {
      console.log('');
      console.log(
        `  ⚠️  derived amount mismatch: expected=${expected} actual=${actual} ` +
          `(floor(${session.duration_sec})s × ${M3_PER_SECOND_RATE_ATOMIC})`,
      );
      console.log(
        '      (this is OK if the duration × rate exceeded the upto MAX and ' +
          'computeSettleAmount clamped it.)',
      );
    } else {
      console.log('');
      console.log(
        `  ✅ amount matches: floor(${session.duration_sec})s × ${M3_PER_SECOND_RATE_ATOMIC} = ${actual}`,
      );
    }
  }

  // M4: surface transcript summary. Full lines are only printed under
  // --transcript / -t flag to keep the default output skim-friendly.
  const transcript = session.transcript ?? [];
  console.log('');
  console.log(`  transcript: ${transcript.length} line(s)`);
  const showFullTranscript = process.argv.includes('--transcript') || process.argv.includes('-t');
  if (transcript.length > 0 && showFullTranscript) {
    console.log('  --- transcript ---');
    for (const line of transcript) {
      console.log(`    ${line}`);
    }
    console.log('  --- end ---');
  } else if (transcript.length > 0) {
    console.log(`  (pass --transcript to print all ${transcript.length} lines)`);
  }
}

main().catch((err: unknown) => {
  console.error(
    '[inspect-session] fatal:',
    err instanceof Error ? (err.stack ?? err.message) : err,
  );
  process.exit(1);
});
