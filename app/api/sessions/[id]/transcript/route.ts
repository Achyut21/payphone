/**
 * POST /api/sessions/[id]/transcript — client-side transcript ingestion.
 *
 * Daily's webhook surface does NOT expose realtime per-utterance events;
 * those only exist as Daily JS SDK events on the call object in the
 * browser. SessionRoom.tsx listens for `transcription-message`, formats
 * each chunk as `[hh:mm:ss] participant: text`, and POSTs it here. We
 * append to the session row's `transcript` list via DDB list_append.
 *
 * Auth: M5 ownership gate via `requireSessionOwner` — only the user
 * whose `cognito_sub` matches `session.user_id` can append transcript
 * lines. Without this guard, any logged-in user could spam transcript
 * lines into anyone else's session (a fun-but-bad griefing vector).
 *
 * Failure modes:
 *   - Bad/unknown id → 404. Not 5xx — we don't want fetch retries
 *     hammering DDB on a typo.
 *   - DDB append failure → 500. The client treats this as best-effort
 *     and just keeps going; the next utterance will retry the chain.
 *
 * `runtime = 'nodejs'` because lib/db uses the AWS SDK.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { appendTranscript } from '@/lib/db';
import { requireSessionOwner } from '@/lib/session-auth';

export const runtime = 'nodejs';

const TranscriptBodySchema = z.object({
  /** Pre-formatted line. The client builds this so the server doesn't need
   *  Daily-specific shapes. Soft cap to keep DDB items reasonable. */
  line: z.string().min(1).max(4000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id || id.length === 0) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  // Auth + ownership check — also covers existence (returns 404 if the
  // session row doesn't exist OR if the current user isn't the owner).
  const guard = await requireSessionOwner(id);
  if (!guard.ok) return guard.response;

  let parsed: z.infer<typeof TranscriptBodySchema>;
  try {
    const json = await request.json();
    parsed = TranscriptBodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', detail: err instanceof Error ? err.message : '' },
      { status: 400 },
    );
  }

  try {
    await appendTranscript(id, parsed.line);
  } catch (err) {
    console.error('[transcript] appendTranscript failed:', err);
    return NextResponse.json({ error: 'append_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
