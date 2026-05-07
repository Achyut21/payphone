/**
 * scripts/register-daily-webhook.ts — register the meeting.ended webhook.
 *
 * Run AFTER starting `pnpm dev` and `ngrok http 3000`. Pass the public
 * webhook URL as the only argv:
 *
 *   pnpm tsx scripts/register-daily-webhook.ts \
 *       https://abc123.ngrok-free.app/api/webhooks/daily
 *
 * What it does:
 *  1. Lists existing webhooks.
 *  2. Deletes any pointing at the same URL (idempotent — re-registering
 *     after an ngrok URL rotation just works).
 *  3. Calls POST /webhooks with our event subscriptions.
 *  4. Prints the returned webhook UUID and the BASE-64 encoded HMAC
 *     secret. The user copies the HMAC into .env.local as
 *     DAILY_WEBHOOK_SECRET and restarts `pnpm dev` so the route can
 *     verify signatures on subsequent deliveries.
 *
 * The HMAC secret is printed once and only once at registration time —
 * Daily's API does not return it again on GET. If you lose it, delete
 * the webhook and re-register.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { deleteWebhook, listWebhooks, registerWebhook } from '../lib/daily';

/**
 * M4 reality check: Daily's webhook API doesn't expose realtime
 * `transcription.message` events — those are CLIENT-SIDE events on the
 * Daily JS SDK (`call.on('transcription-message', ...)`). The webhook
 * surface only has lifecycle events (`meeting.*`, `participant.*`,
 * `transcript.started`, `transcript.ready-to-download`, `transcript.error`).
 *
 * For PayPhone, realtime utterance capture happens in the browser
 * (`components/SessionRoom.tsx`) and POSTs each line to
 * `/api/sessions/[id]/transcript`.
 *
 * M4.9: subscribe to participant.joined / participant.left in addition
 * to meeting.ended. Active-window billing tracks the participant count
 * via these events: window opens when count reaches 2, closes when it
 * drops back below 2. Settle now fires from participant.left when the
 * window closes (not from meeting.ended which only fires when the room
 * is fully empty). meeting.ended is kept as an idempotent fallback.
 */
const EVENTS = ['meeting.ended', 'participant.joined', 'participant.left'];

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target || target.startsWith('-')) {
    console.error(
      'Usage: pnpm tsx scripts/register-daily-webhook.ts <webhook-url>\n' +
        'Example: pnpm tsx scripts/register-daily-webhook.ts ' +
        'https://abc123.ngrok-free.app/api/webhooks/daily',
    );
    process.exit(1);
  }
  if (!target.startsWith('https://')) {
    console.error('Webhook URL must be HTTPS. ngrok provides this for free.');
    process.exit(1);
  }

  console.log(`[register-daily-webhook] target: ${target}`);

  // Idempotency: drop any prior webhook for the same URL.
  const existing = await listWebhooks();
  const matches = existing.filter((w) => w.url === target);
  for (const w of matches) {
    console.log(`[register-daily-webhook] deleting prior webhook uuid=${w.uuid}`);
    await deleteWebhook(w.uuid);
  }

  // Even if there are no exact-URL matches, also clear any other webhooks
  // that look like leftover ngrok URLs (those rotate). Keep it conservative:
  // only delete URLs whose pathname matches our /api/webhooks/daily path.
  const stale = existing.filter((w) => w.url !== target && w.url.includes('/api/webhooks/daily'));
  for (const w of stale) {
    console.log(
      `[register-daily-webhook] cleaning stale ngrok webhook uuid=${w.uuid} url=${w.url}`,
    );
    await deleteWebhook(w.uuid);
  }

  console.log(`[register-daily-webhook] registering webhook for events: ${EVENTS.join(', ')}`);
  const created = await registerWebhook(target, EVENTS);

  console.log('');
  console.log('✅ webhook registered');
  console.log(`   uuid:   ${created.uuid}`);
  console.log(`   url:    ${created.url}`);
  console.log(`   events: ${(created.eventTypes ?? EVENTS).join(', ')}`);
  console.log(`   state:  ${created.state ?? '(unknown)'}`);
  console.log('');
  console.log('🔑 HMAC secret (BASE-64). Add to .env.local then restart `pnpm dev`:');
  console.log('');
  console.log(`   DAILY_WEBHOOK_SECRET=${created.hmac}`);
  console.log('');
  console.log('   The dev server is currently accepting unverified test pings until you ');
  console.log('   set this env var (see app/api/webhooks/daily/route.ts).');
}

main().catch((err: unknown) => {
  console.error(
    '[register-daily-webhook] fatal:',
    err instanceof Error ? (err.stack ?? err.message) : err,
  );
  process.exit(1);
});
