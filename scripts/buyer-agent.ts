/**
 * PayPhone — buyer agent CLI (diagnostic).
 *
 * Thin wrapper around `lib/agent.ts.requestSession`. The core x402 flow
 * lives in the lib module so server actions and this CLI share one
 * implementation. The CLI exists for two reasons:
 *
 *   1. Diagnostic: when something breaks in M3+ end-to-end, `pnpm tsx
 *      scripts/buyer-agent.ts` lets you exercise the buyer side without
 *      touching the UI. Errors surface plainly on stderr instead of the
 *      Next error overlay's stack-trace truncation.
 *   2. M3 carry-over: the original M3 acceptance flow (two-tab manual
 *      test) still works exactly as before — useful for re-validating
 *      backend changes without the M4 UI in the way.
 *
 * Usage:
 *   pnpm tsx scripts/buyer-agent.ts              # uses defaults below
 *   pnpm tsx scripts/buyer-agent.ts <userId>     # override user
 *   pnpm tsx scripts/buyer-agent.ts <userId> <expertId> [topic]
 *
 * Defaults match real seeded ids so the resulting DDB row is consistent
 * with what the M4 UI would produce.
 */

import dotenv from 'dotenv';
// .env.local must be loaded before any function below reads CDP env vars.
// Imports are side-effect-free re: env (lib reads env inside function bodies).
dotenv.config({ path: '.env.local' });

import { requestSession } from '../lib/agent';
import { ACTIVE_CAIP2, ACTIVE_NETWORK } from '../lib/constants';

const DEFAULT_USER_ID = 'alice';
const DEFAULT_EXPERT_ID = 'expert-alice-chen';
const DEFAULT_TOPIC = 'CLI diagnostic call';

async function main(): Promise<void> {
  const userId = process.argv[2] ?? DEFAULT_USER_ID;
  const expertId = process.argv[3] ?? DEFAULT_EXPERT_ID;
  const topic = process.argv[4] ?? DEFAULT_TOPIC;

  console.log(`[buyer-agent] network: ${ACTIVE_NETWORK} (${ACTIVE_CAIP2})`);
  console.log(`[buyer-agent] user=${userId} expert=${expertId}`);
  console.log(`[buyer-agent] topic="${topic}"`);
  console.log(`[buyer-agent] running x402 round-trip…`);

  const result = await requestSession({ topic, userId, expertId });

  console.log(`[buyer-agent] HTTP 200 OK`);
  console.log(`[buyer-agent]   sessionId:     ${result.sessionId}`);
  console.log(`[buyer-agent]   maxAuthorized: $${result.maxAuthorized}`);
  console.log(`[buyer-agent]   status:        ${result.status}`);
  console.log(`[buyer-agent]   payer:         ${result.payer}`);
  console.log(`[buyer-agent]   network:       ${result.network}`);
  console.log('');
  console.log('🎥 Open this URL in TWO browser tabs to test M3-style settlement:');
  console.log('');
  console.log(`   ${result.roomUrl}`);
  console.log('');
  console.log('   Talk for ~30–60 seconds, then click "Leave" in either tab.');
  console.log('   Daily will fire `meeting.ended` to /api/webhooks/daily,');
  console.log('   which will compute duration × rate, settle on-chain, and');
  console.log('   mark the DDB row COMPLETED.');
  console.log('');
  console.log('🔍 After hangup, inspect the final state with:');
  console.log('');
  console.log(`   pnpm tsx scripts/inspect-session.ts ${result.sessionId}`);
  console.log('');
}

main().catch((err: unknown) => {
  console.error('[buyer-agent] fatal:', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
