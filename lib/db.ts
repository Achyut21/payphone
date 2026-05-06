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
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const REQUIRED_DDB_ENV_VARS = [
  'AWS_REGION',
  'DYNAMODB_TABLE_NAME',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

function assertDdbEnv(): void {
  const missing = REQUIRED_DDB_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `AWS DynamoDB env vars missing: ${missing.join(', ')}. ` +
        `Run \`terraform output\` from infra/terraform and append values to .env.local.`,
    );
  }
}

let _doc: DynamoDBDocumentClient | null = null;

/**
 * Returns a singleton DocumentClient. The default credential provider chain
 * picks up AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from process.env, which
 * the SDK prefers over `~/.aws/credentials`. That's how we keep the
 * Terraform bootstrap creds (admin, in `~/.aws/credentials`) separate from
 * the runtime app creds (DDB-only, in .env.local).
 */
function getDoc(): DynamoDBDocumentClient {
  if (_doc === null) {
    assertDdbEnv();
    const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });
    _doc = DynamoDBDocumentClient.from(ddb, {
      // Allow optional fields on SessionRow to be set to undefined and just
      // omitted from the persisted item rather than rejected with an error.
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return _doc;
}

/** Lifecycle states for a session. Used as the DDB `status` attribute. */
export type SessionStatus = 'AUTHORIZED' | 'ACTIVE' | 'COMPLETED' | 'SETTLE_FAILED';

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
  max_authorized_amount: number;
  status: SessionStatus;
  expires_at: number;
  ended_at?: number;
  duration_sec?: number;
  settled_amount?: number;
  settle_tx_hash?: string;
  transcript?: string;
  summary?: string;
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
 * Mark a session as COMPLETED with the on-chain settle results. Conditional
 * on `status = AUTHORIZED` — this is the double-settle guard. If Daily
 * retries the webhook (e.g., our 200 response was lost), the second update
 * fails with ConditionalCheckFailedException. The webhook route catches
 * that and returns 200 to stop further retries; the original tx is already
 * on-chain so this is the correct idempotent behavior.
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
      ConditionExpression: '#status = :authorized',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':completed': 'COMPLETED' satisfies SessionStatus,
        ':authorized': 'AUTHORIZED' satisfies SessionStatus,
        ':amt': fields.settled_amount,
        ':hash': fields.settle_tx_hash,
        ':ended': fields.ended_at,
        ':duration': fields.duration_sec,
      },
    }),
  );
}
