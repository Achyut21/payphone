/**
 * PayPhone — Daily.co REST client + webhook signature verification.
 *
 * Three responsibilities:
 *  1. createRoom — POST /v1/rooms to provision a 30-min, 2-participant
 *     video room (CONTEXT.md safety rails: no recording, no streaming,
 *     no telephony, no transcription in M3 — that's M4).
 *  2. registerWebhook / listWebhooks / deleteWebhook — manage the
 *     `/v1/webhooks` resource. Used only by scripts/register-daily-webhook.ts
 *     for one-off setup; the runtime app never registers/deletes.
 *  3. verifyWebhookSignature — HMAC-SHA256 verification of incoming
 *     webhook deliveries before we trust the body.
 *
 * Daily docs: https://docs.daily.co/reference/rest-api/webhooks
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { DAILY_ROOM_TTL_SECONDS } from '@/lib/constants';

const DAILY_API_BASE = 'https://api.daily.co/v1' as const;

function assertDailyEnv(): void {
  if (!process.env.DAILY_API_KEY) {
    throw new Error(
      'DAILY_API_KEY is not set. Add it to .env.local. ' +
        'You can find your key at https://dashboard.daily.co/developers.',
    );
  }
}

function authHeader(): { Authorization: string } {
  assertDailyEnv();
  return { Authorization: `Bearer ${process.env.DAILY_API_KEY}` };
}

/**
 * Common fetch wrapper that surfaces Daily's structured error bodies. The
 * Daily REST API returns 4xx/5xx with a JSON body like
 * `{ error: "...", info: "..." }`; we lift those into the thrown Error so
 * route handlers can log a descriptive failure reason without leaking
 * the API key (which only lives in the request headers we constructed).
 */
async function dailyFetch(
  path: string,
  init: RequestInit & { method: 'GET' | 'POST' | 'DELETE' },
): Promise<unknown> {
  const url = `${DAILY_API_BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...authHeader(),
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'info' in parsed && typeof parsed.info === 'string'
        ? parsed.info
        : parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : text || `HTTP ${response.status}`;
    throw new Error(`Daily ${init.method} ${path} failed: ${detail}`);
  }
  return parsed;
}

/**
 * Daily room as returned by POST /rooms (subset we care about).
 *
 * `name` and `id` differ: `name` is the URL path segment (e.g. `abc-xyz`),
 * `id` is an opaque server-side UUID. The `meeting.ended` webhook payload
 * uses the room *name* in its `room` field, so that's what we store and
 * key off.
 */
type DailyRoomResponse = {
  id: string;
  name: string;
  url: string;
  privacy?: 'public' | 'private';
};

export type DailyRoom = {
  id: string;
  name: string;
  url: string;
};

/**
 * Create a Daily.co video room sized for a PayPhone session.
 *
 * Properties enforce the CONTEXT.md safety rails on every room:
 *   - `exp` / `nbf`: 30-min validity window starting now
 *   - `eject_at_room_exp`: kick everyone at exp (don't let calls overrun)
 *   - `max_participants: 2`: buyer + expert only
 *   - `enable_prejoin_ui: false`: drop straight into the call (faster demo)
 *   - `enable_chat: false`: keep the focus on the call itself
 *   - NO recording, NO streaming, NO transcription (M4 will enable that)
 *
 * Returns the bits we persist to DDB: id, name, url. Daily generates the
 * room name automatically when we don't pass one — that's fine; we don't
 * need a stable human-readable name.
 */
export async function createRoom(): Promise<DailyRoom> {
  const nowSec = Math.floor(Date.now() / 1000);
  const body = {
    properties: {
      nbf: nowSec,
      exp: nowSec + DAILY_ROOM_TTL_SECONDS,
      eject_at_room_exp: true,
      max_participants: 2,
      enable_prejoin_ui: false,
      enable_chat: false,
      // Defensive: explicit nulls/false for the disabled features. Daily
      // defaults already exclude these for free-tier accounts, but pinning
      // them here makes the intent obvious in code review.
      enable_recording: null,
      enable_screenshare: true,
    },
  };
  const response = (await dailyFetch('/rooms', {
    method: 'POST',
    body: JSON.stringify(body),
  })) as DailyRoomResponse;
  return { id: response.id, name: response.name, url: response.url };
}

/* --- Webhook management (used by scripts/register-daily-webhook.ts) --- */

export type DailyWebhook = {
  uuid: string;
  url: string;
  hmac: string; // base64-encoded HMAC secret
  state?: 'ACTIVE' | 'FAILED';
  eventTypes?: string[];
};

type DailyWebhookListResponse = {
  total_count?: number;
  data: DailyWebhook[];
};

/** List currently-registered webhooks. */
export async function listWebhooks(): Promise<DailyWebhook[]> {
  const response = (await dailyFetch('/webhooks', { method: 'GET' })) as
    | DailyWebhookListResponse
    | DailyWebhook[];
  // Daily's response shape has shifted historically; accept both an array
  // and a `{ data: [...] }` envelope.
  if (Array.isArray(response)) return response;
  return response.data ?? [];
}

/** Delete a webhook by uuid. Idempotent — 404 is treated as success. */
export async function deleteWebhook(uuid: string): Promise<void> {
  try {
    await dailyFetch(`/webhooks/${uuid}`, { method: 'DELETE' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Treat already-gone as success.
    if (!msg.includes('404') && !msg.toLowerCase().includes('not found')) throw err;
  }
}

/**
 * Register a webhook target with the given event types. The returned
 * `hmac` is the base64-encoded shared secret used for signature
 * verification on inbound deliveries — store this as DAILY_WEBHOOK_SECRET
 * in .env.local.
 *
 * Idempotency note: `register-daily-webhook.ts` deletes any existing
 * webhook pointing at the same URL before calling this, so re-registering
 * after an ngrok URL rotation is safe.
 */
export async function registerWebhook(url: string, eventTypes: string[]): Promise<DailyWebhook> {
  const response = (await dailyFetch('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ url, eventTypes }),
  })) as DailyWebhook;
  return response;
}

/* --- HMAC signature verification --- */

/**
 * Verify a Daily webhook signature.
 *
 * Daily's docs (https://docs.daily.co/reference/rest-api/webhooks#hmac)
 * tell us:
 *   - The hmac secret is BASE-64 encoded
 *   - Two headers are sent: X-Webhook-Signature and X-Webhook-Timestamp
 *   - HMAC-SHA256 is the algorithm
 *
 * What's *not* explicit in the docs is whether the signed string is just
 * the raw body, or `${timestamp}.${rawBody}` (the Stripe-style replay-
 * resistant pattern). The docs render the actual code snippet via JS so
 * fetching them yields no canonical answer. To stay correct without
 * guessing, we try BOTH variants in priority order. Either pattern still
 * requires the secret, so accepting both doesn't broaden the attack
 * surface — it just trades a bit of replay protection for
 * compatibility-by-defense.
 *
 * After M3's first successful end-to-end test we should observe which
 * variant Daily actually uses and lock to it (M5 hardening). Until then
 * the multi-variant check is the safest hackathon move.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  base64Secret: string,
): { valid: boolean; variant?: 'body' | 'timestamp.body' } {
  if (!signatureHeader) return { valid: false };

  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(base64Secret, 'base64');
  } catch {
    return { valid: false };
  }
  if (secretBytes.length === 0) return { valid: false };

  const sigBuf = Buffer.from(signatureHeader, 'utf8');

  // Variant A: HMAC over the raw body alone (matches the docs phrasing
  // "you can sign the content with the HMAC-sha256 string", where
  // "content" = "the response body from the event").
  const macA = createHmac('sha256', secretBytes).update(rawBody).digest('base64');
  const macABuf = Buffer.from(macA, 'utf8');
  if (sigBuf.length === macABuf.length && timingSafeEqual(sigBuf, macABuf)) {
    return { valid: true, variant: 'body' };
  }

  // Variant B: HMAC over `${timestamp}.${rawBody}` (Stripe-style). Only
  // attempted if a timestamp header is present.
  if (timestampHeader && timestampHeader.length > 0) {
    const macB = createHmac('sha256', secretBytes)
      .update(`${timestampHeader}.${rawBody}`)
      .digest('base64');
    const macBBuf = Buffer.from(macB, 'utf8');
    if (sigBuf.length === macBBuf.length && timingSafeEqual(sigBuf, macBBuf)) {
      return { valid: true, variant: 'timestamp.body' };
    }
  }

  return { valid: false };
}
