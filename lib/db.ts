/**
 * PayPhone — DynamoDB session store.
 *
 * Single table `payphone-sessions`, schema per RESEARCH_DOSSIER.md §6.
 * Provisioned by Terraform in `infra/terraform/dynamodb.tf` with TTL on
 * `expires_at` so abandoned rows self-clean after 24h.
 *
 * Env loading:
 *  - In Next.js API routes, `.env.local` is auto-loaded by Next at startup.
 *  - In standalone Node scripts, the script must call dotenv.config()
 *    BEFORE importing this module (see scripts/inspect-session.ts).
 *
 * Credentials flow through process.env via the AWS SDK's default provider
 * chain — we never read `.env.local` directly. The runtime IAM user
 * `payphone-app` (Terraform-managed) only has DDB CRUD on this one table.
 *
 * M5 / Amplify: AWS Amplify Hosting reserves the `AWS_*` env-var prefix
 * for its own internal use and refuses to let us set `AWS_REGION`,
 * `AWS_ACCESS_KEY_ID`, or `AWS_SECRET_ACCESS_KEY` on a hosted app. So
 * we read either the standard names (local dev / .env.local) OR the
 * `APP_AWS_*` aliases (Amplify-hosted). The lookup prefers `APP_AWS_*`
 * when present so a future move to Lambda execution roles only requires
 * deleting the `APP_AWS_*` entries from Amplify (not editing this file).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { ParticipantEvent } from '@/lib/billing';

/**
 * Resolve AWS credentials + region from process.env, preferring the
 * Amplify-safe `APP_AWS_*` prefix and falling back to the standard
 * names. Returns nulls for missing fields so the caller can decide
 * whether absent credentials are a hard error (we use them for DDB,
 * which is mandatory) or a soft fall-through (e.g. the Lambda role's
 * default chain — not what we want here, but legal).
 */
function resolveAwsConfig(): {
  region: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
} {
  return {
    region: process.env.APP_AWS_REGION ?? process.env.AWS_REGION ?? null,
    accessKeyId: process.env.APP_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? null,
    secretAccessKey:
      process.env.APP_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? null,
  };
}

function assertDdbEnv(): void {
  const cfg = resolveAwsConfig();
  const missing: string[] = [];
  if (!cfg.region) missing.push('AWS_REGION (or APP_AWS_REGION)');
  if (!cfg.accessKeyId) missing.push('AWS_ACCESS_KEY_ID (or APP_AWS_ACCESS_KEY_ID)');
  if (!cfg.secretAccessKey) missing.push('AWS_SECRET_ACCESS_KEY (or APP_AWS_SECRET_ACCESS_KEY)');
  if (!process.env.DYNAMODB_TABLE_NAME) missing.push('DYNAMODB_TABLE_NAME');
  if (missing.length > 0) {
    throw new Error(
      `AWS DynamoDB env vars missing: ${missing.join(', ')}. ` +
        `Run \`terraform output\` from infra/terraform and append values to .env.local ` +
        `(or set them in Amplify with the APP_AWS_* aliases).`,
    );
  }
}

let _doc: DynamoDBDocumentClient | null = null;

/**
 * Returns a singleton DocumentClient. Credentials and region are
 * resolved from `APP_AWS_*` (Amplify) or `AWS_*` (local dev) and
 * passed to the SDK explicitly — relying on the SDK's default chain
 * would break under Amplify because the standard `AWS_*` names there
 * are reserved.
 *
 * Exported (M5) so sibling modules like `lib/user-wallet.ts` reuse the
 * same client. Direct callers should still prefer the typed helpers in
 * this file (createSession, getSession, etc.) — `getDoc` is for tables
 * outside the sessions schema (e.g. payphone-users).
 */
export function getDoc(): DynamoDBDocumentClient {
  if (_doc === null) {
    assertDdbEnv();
    const cfg = resolveAwsConfig();
    const ddb = new DynamoDBClient({
      // Both fields are non-null after assertDdbEnv passed.
      region: cfg.region as string,
      credentials: {
        accessKeyId: cfg.accessKeyId as string,
        secretAccessKey: cfg.secretAccessKey as string,
      },
    });
    _doc = DynamoDBDocumentClient.from(ddb, {
      // Allow optional fields on SessionRow to be set to undefined and just
      // omitted from the persisted item rather than rejected with an error.
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return _doc;
}

/** Lifecycle states for a session. Used as the DDB `status` attribute. */
export type SessionStatus = 'AUTHORIZED' | 'ACTIVE' | 'COMPLETED' | 'SETTLE_FAILED' | 'TIMEOUT';

/**
 * Session row schema. Field names use snake_case to match the underlying
 * DDB attributes 1:1 (no marshalling indirection). All amount fields are
 * stored as Numbers (atomic USDC units), not BigInts — DDB doesn't have a
 * BigInt type, but Number's safe integer range (2^53) is well above
 * `M2_UPTO_MAX_ATOMIC` (5_000_000), so there's no precision risk.
 *
 * `payment_authorization_payload` holds the buyer's signed x402
 * PaymentPayload as a base64-encoded JSON string. We need to round-trip it
 * verbatim from /sessions to the webhook so settle uses the exact same
 * bytes the buyer signed.
 *
 * M4.9 additions:
 *   - `participant_events` — append-only log of joined/left events from
 *     Daily webhooks. Drives the active-window billing math
 *     (`lib/billing.ts`).
 *   - `billable_window_start_ms` / `billable_window_end_ms` — locked-once
 *     timestamps marking when the count first reached 2 and first
 *     dropped below 2. Set by the webhook; checked by status route +
 *     timeout logic.
 *   - `started_at_ms` — ms-precision creation time used by the 90s no-
 *     expert-joined timeout. The original `started_at` is unix seconds;
 *     we keep both rather than migrate the schema.
 */
export type SessionRow = {
  session_id: string;
  user_id: string;
  expert_id: string;
  agent_wallet_addr: string;
  payment_authorization_payload: string;
  video_room_id: string;
  video_room_url: string;
  started_at: number;
  /** Optional ms-precision creation time (M4.9). Used by the 90s timeout
   *  check. Older rows persisted before M4.9 won't have this and the
   *  timeout check derives it from `started_at * 1000` as a fallback. */
  started_at_ms?: number;
  max_authorized_amount: number;
  status: SessionStatus;
  expires_at: number;
  ended_at?: number;
  duration_sec?: number;
  settled_amount?: number;
  settle_tx_hash?: string;
  transcript?: string[];
  summary?: string;
  /** M4.9: append-only Daily participant lifecycle events. */
  participant_events?: ParticipantEvent[];
  /** M4.9: locked once when participant count first reaches 2. */
  billable_window_start_ms?: number;
  /** M4.9: locked once when participant count first drops below 2. */
  billable_window_end_ms?: number;
};

/**
 * Insert a new session row. Conditional on `attribute_not_exists(session_id)`
 * — a UUID collision (cosmically unlikely, but cheap to guard against)
 * surfaces as a thrown ConditionalCheckFailedException rather than silent
 * overwrite.
 */
export async function createSession(row: SessionRow): Promise<void> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  await getDoc().send(
    new PutCommand({
      TableName: tableName,
      Item: row,
      ConditionExpression: 'attribute_not_exists(session_id)',
    }),
  );
}

/** Get a session by primary key. Returns null if not found. */
export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  const result = await getDoc().send(
    new GetCommand({
      TableName: tableName,
      Key: { session_id: sessionId },
    }),
  );
  return (result.Item as SessionRow | undefined) ?? null;
}

/**
 * Find a session by Daily room id. The webhook payload identifies the
 * meeting by `room` (the room name/id), not our `session_id`, so we have
 * to look it up.
 *
 * Implementation: DDB Scan with FilterExpression. NOTE on Scan + Limit:
 * Limit applies BEFORE the filter, not after — so passing `Limit: 1` on
 * a 1000-row table where only 1 matches would return 0 results. At
 * hackathon scale (<100 sessions over the lifetime of the demo) the table
 * fits in one Scan page (1MB) so we don't paginate. M5 mainnet should
 * either add a GSI on `video_room_id` or move to fully-qualified composite
 * keys. Tracked in PROGRESS.md.
 */
export async function getSessionByRoomId(roomId: string): Promise<SessionRow | null> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  const result = await getDoc().send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: 'video_room_id = :roomId',
      ExpressionAttributeValues: { ':roomId': roomId },
    }),
  );
  const items = (result.Items ?? []) as SessionRow[];
  return items[0] ?? null;
}

/**
 * Most recent COMPLETED session, used by the marketing landing's "live
 * last-call" widget (M4.5 Phase 3). Scans the table, filters to status =
 * COMPLETED, sorts client-side by `ended_at` desc, returns the top one.
 *
 * DDB has no native ORDER BY in Scan — you sort on the read side. At
 * hackathon scale the table holds <100 rows so a full Scan fits in a
 * single 1MB page; M5 polish if it ever matters: add a GSI keyed on
 * `status` with `ended_at` as the sort key.
 *
 * Returns `null` on empty / all-pre-M3 tables. The landing falls back to
 * static demo copy in that case (the M4 canonical tx) — never blocks
 * page render.
 *
 * Caller-side caching: pages that consume this should set
 * `export const revalidate = 30` (or similar) so we Scan at most every
 * 30s, not on every visitor.
 */
export async function getLatestCompletedSession(): Promise<SessionRow | null> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  const result = await getDoc().send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: '#status = :completed',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':completed': 'COMPLETED' satisfies SessionStatus },
    }),
  );
  const items = (result.Items ?? []) as SessionRow[];
  if (items.length === 0) return null;
  // Sort newest-first by `ended_at` (set in markSessionCompleted). Rows
  // without `ended_at` are treated as oldest — they shouldn't exist for
  // status=COMPLETED but the guard is free.
  items.sort((a, b) => (b.ended_at ?? 0) - (a.ended_at ?? 0));
  return items[0] ?? null;
}

/**
 * Mark a session as COMPLETED with the on-chain settle results. Conditional
 * on status being AUTHORIZED or ACTIVE — this is the double-settle guard.
 * If a duplicate webhook delivery (e.g., participant.left + meeting.ended
 * both firing) tries to settle a session that's already COMPLETED, the
 * second update fails with ConditionalCheckFailedException. The webhook
 * route catches that and returns 200 to stop further retries; the
 * original tx is already on-chain so this is the correct idempotent
 * behavior.
 *
 * M4.9: ACTIVE is now valid as a "settle from" state because the active-
 * window flow transitions AUTHORIZED -> ACTIVE on the first
 * participant.joined event. Settle then fires from participant.left when
 * the window closes; at that point status is still ACTIVE.
 *
 * `#status` is aliased because `status` is a DDB reserved word.
 */
export async function markSessionCompleted(
  sessionId: string,
  fields: {
    settled_amount: number;
    settle_tx_hash: string;
    ended_at: number;
    duration_sec: number;
  },
): Promise<void> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  await getDoc().send(
    new UpdateCommand({
      TableName: tableName,
      Key: { session_id: sessionId },
      UpdateExpression:
        'SET #status = :completed, settled_amount = :amt, settle_tx_hash = :hash, ended_at = :ended, duration_sec = :duration',
      ConditionExpression: '#status IN (:authorized, :active)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':completed': 'COMPLETED' satisfies SessionStatus,
        ':authorized': 'AUTHORIZED' satisfies SessionStatus,
        ':active': 'ACTIVE' satisfies SessionStatus,
        ':amt': fields.settled_amount,
        ':hash': fields.settle_tx_hash,
        ':ended': fields.ended_at,
        ':duration': fields.duration_sec,
      },
    }),
  );
}

/**
 * Append a participant event to the session's event log. Atomic via DDB
 * `list_append + if_not_exists` (same pattern as transcript). Returns
 * the updated row so callers can immediately recompute the active window
 * over the full event log.
 *
 * Why we return the row: the webhook handler needs to call
 * `computeBillableWindow(row.participant_events)` after the append to
 * decide whether the window just opened/closed. Doing the append + read
 * in one atomic UpdateItem with `ReturnValues: 'ALL_NEW'` is cheaper
 * and race-free vs. update + get.
 */
export async function appendParticipantEvent(
  sessionId: string,
  event: ParticipantEvent,
): Promise<SessionRow> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  const result = await getDoc().send(
    new UpdateCommand({
      TableName: tableName,
      Key: { session_id: sessionId },
      UpdateExpression:
        'SET participant_events = list_append(if_not_exists(participant_events, :empty), :delta)',
      ExpressionAttributeValues: {
        ':empty': [] as ParticipantEvent[],
        ':delta': [event],
      },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return result.Attributes as SessionRow;
}

/**
 * Set `billable_window_start_ms` once. Conditional on the field NOT
 * already existing (idempotent — a duplicate webhook delivery is a
 * no-op). Use this AFTER appending a participant.joined event and
 * recomputing the window — only call when `computeBillableWindow`
 * reports a `start_ms` and the row's existing field is undefined.
 */
export async function setBillableWindowStart(sessionId: string, ts_ms: number): Promise<void> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  try {
    await getDoc().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { session_id: sessionId },
        UpdateExpression: 'SET billable_window_start_ms = :ts',
        ConditionExpression: 'attribute_not_exists(billable_window_start_ms)',
        ExpressionAttributeValues: { ':ts': ts_ms },
      }),
    );
  } catch (err) {
    // ConditionalCheckFailedException is expected on duplicate webhook
    // delivery; swallow it. Anything else bubbles.
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      err.name === 'ConditionalCheckFailedException'
    ) {
      return;
    }
    throw err;
  }
}

/**
 * Set `billable_window_end_ms` once. Mirror of `setBillableWindowStart`
 * — conditional + idempotent. Called when participant count first
 * drops below 2.
 */
export async function setBillableWindowEnd(sessionId: string, ts_ms: number): Promise<void> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  try {
    await getDoc().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { session_id: sessionId },
        UpdateExpression: 'SET billable_window_end_ms = :ts',
        ConditionExpression: 'attribute_not_exists(billable_window_end_ms)',
        ExpressionAttributeValues: { ':ts': ts_ms },
      }),
    );
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      err.name === 'ConditionalCheckFailedException'
    ) {
      return;
    }
    throw err;
  }
}

/**
 * Transition AUTHORIZED -> ACTIVE. Called by the webhook when the
 * active window first opens (participant count reaches 2). Conditional
 * on `#status = AUTHORIZED` so a duplicate webhook delivery is a no-op
 * (the second call hits ConditionalCheckFailedException, which we
 * swallow — the row is already in the correct state).
 *
 * No-op if the row is already ACTIVE / COMPLETED / SETTLE_FAILED /
 * TIMEOUT — those terminal-or-later states win over a stale transition.
 */
export async function markSessionActive(sessionId: string): Promise<void> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  try {
    await getDoc().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { session_id: sessionId },
        UpdateExpression: 'SET #status = :active',
        ConditionExpression: '#status = :authorized',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':active': 'ACTIVE' satisfies SessionStatus,
          ':authorized': 'AUTHORIZED' satisfies SessionStatus,
        },
      }),
    );
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      err.name === 'ConditionalCheckFailedException'
    ) {
      return;
    }
    throw err;
  }
}

/**
 * Transition AUTHORIZED -> TIMEOUT. Called by the status route when a
 * session has been waiting for the second participant for more than
 * 90 seconds. Conditional on `#status = AUTHORIZED` AND
 * `attribute_not_exists(billable_window_start_ms)` — once the window
 * has opened, the call is real and TIMEOUT no longer applies.
 *
 * No on-chain settle fires for TIMEOUT. The Permit2 authorization
 * simply expires at its deadline (30 min). Zero USDC moves.
 */
export async function markSessionTimedOut(sessionId: string): Promise<void> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  try {
    await getDoc().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { session_id: sessionId },
        UpdateExpression: 'SET #status = :timeout',
        ConditionExpression:
          '#status = :authorized AND attribute_not_exists(billable_window_start_ms)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':timeout': 'TIMEOUT' satisfies SessionStatus,
          ':authorized': 'AUTHORIZED' satisfies SessionStatus,
        },
      }),
    );
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      err.name === 'ConditionalCheckFailedException'
    ) {
      return;
    }
    throw err;
  }
}

/**
 * Mark a session SETTLE_FAILED after the retry loop in `lib/x402.ts`
 * exhausted all attempts. The buyer's authorization stays valid until
 * its deadline (30 min); the recap page surfaces a "Settlement failed"
 * banner with a manual-retry option (Phase 6).
 *
 * Conditional on `#status IN (AUTHORIZED, ACTIVE)` — same allowed-from
 * set as `markSessionCompleted` because settle can fire from either.
 */
export async function markSessionFailed(
  sessionId: string,
  fields: { ended_at: number; duration_sec: number },
): Promise<void> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  try {
    await getDoc().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { session_id: sessionId },
        UpdateExpression: 'SET #status = :failed, ended_at = :ended, duration_sec = :duration',
        ConditionExpression: '#status IN (:authorized, :active)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':failed': 'SETTLE_FAILED' satisfies SessionStatus,
          ':authorized': 'AUTHORIZED' satisfies SessionStatus,
          ':active': 'ACTIVE' satisfies SessionStatus,
          ':ended': fields.ended_at,
          ':duration': fields.duration_sec,
        },
      }),
    );
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      err.name === 'ConditionalCheckFailedException'
    ) {
      return;
    }
    throw err;
  }
}

/**
 * Retry-success path: SETTLE_FAILED -> COMPLETED. Used by the manual
 * retry endpoint (`POST /api/sessions/[id]/retry-settle`) when the
 * buyer hits "Retry settlement" on the recap after the initial settle
 * exhausted retries. Conditional on `#status = SETTLE_FAILED` so a
 * duplicate click can't double-write.
 *
 * Kept SEPARATE from `markSessionCompleted` (which only allows
 * AUTHORIZED/ACTIVE) so the normal-flow conditional stays narrow —
 * broadening that set could mask a real "settle fired on a row in the
 * wrong state" bug.
 */
export async function markSessionRetrySettled(
  sessionId: string,
  fields: { settled_amount: number; settle_tx_hash: string },
): Promise<void> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  await getDoc().send(
    new UpdateCommand({
      TableName: tableName,
      Key: { session_id: sessionId },
      UpdateExpression: 'SET #status = :completed, settled_amount = :amt, settle_tx_hash = :hash',
      ConditionExpression: '#status = :failed',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':completed': 'COMPLETED' satisfies SessionStatus,
        ':failed': 'SETTLE_FAILED' satisfies SessionStatus,
        ':amt': fields.settled_amount,
        ':hash': fields.settle_tx_hash,
      },
    }),
  );
}

/**
 * Append one utterance to a session's `transcript` (M4). Daily fires a
 * `transcription.message` event per utterance; we accumulate them into a
 * DDB List of strings. Reads (`getSession().transcript`) come back as
 * `string[]`; the recap LLM (Phase 6) joins on `\n` for the system
 * context. Each line is conventionally `[hh:mm:ss] speaker: text` —
 * formatted by the webhook before this helper is called.
 *
 * Why a List, not a String: DDB's `UpdateExpression` has `list_append`
 * for lists but no native string-concat operator. The alternative
 * (read-then-write) is race-prone under concurrent webhook deliveries.
 * `list_append + if_not_exists` is atomic.
 *
 * Concurrency: DDB serializes UpdateItem against the same key, so two
 * concurrent appends both land — order may not match wall-clock if
 * Daily ever delivers out-of-order, but at human speech rates over a
 * 2-participant call this is unmeasurable. M5 polish if it ever matters:
 * a per-event sequence number on each line.
 *
 * Empty/whitespace deltas are dropped to keep the field tidy.
 *
 * Failure mode: best-effort. The route catches and logs append errors
 * and returns 200 to Daily — the on-chain settle path (driven by
 * `meeting.ended`) is unaffected.
 */
export async function appendTranscript(sessionId: string, line: string): Promise<void> {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  await getDoc().send(
    new UpdateCommand({
      TableName: tableName,
      Key: { session_id: sessionId },
      UpdateExpression: 'SET transcript = list_append(if_not_exists(transcript, :empty), :delta)',
      ExpressionAttributeValues: {
        ':empty': [] as string[],
        ':delta': [trimmed],
      },
    }),
  );
}
