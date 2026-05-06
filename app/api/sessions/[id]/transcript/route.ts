/**
 * POST /api/sessions/[id]/transcript — client-side transcript ingestion.
 *
 * Daily's webhook surface does NOT expose realtime per-utterance events;
 * those only exist as Daily JS SDK events on the call object in the
 * browser. SessionRoom.tsx listens for `transcription-message`, formats
 * each chunk as `[hh:mm:ss] participant: text`, and POSTs it here. We
 * append to the session row's `transcript` list via DDB list_append.
 *
 * Auth: cookie-gated by the proxy in `proxy.ts` since this lives under
 * `/api/sessions/...`. Wait — `proxy.ts` only matches `/` and
 * `/session/:path*`, NOT `/api/sessions/...`. So we re-check the cookie
 * here. We don't enforce that the cookie's user owns this specific
 * session — M5 polish; for the demo it's fine, since the only way a
 * client gets the session id is by going through `startSession`.
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

import { getCurrentUser } from '@/lib/auth';
import { appendTranscript, getSession } from '@/lib/db';

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
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { id } = await params;
  if (!id || id.length === 0) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  // Quick existence check so we don't write transcript lines into a
  // wrong/typoed session id (DDB UpdateItem would create a phantom row
  // — the row's other required fields would be missing but the
  // `transcript` list would still be persisted).
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

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
