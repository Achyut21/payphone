/**
 * GET /api/sessions/[id]/recap — streams an AI-generated summary of the
 * call.
 *
 * Reads the session's transcript + topic-equivalent (the expert name) from
 * DDB, calls Haiku, returns a streaming `Response`. The client uses the
 * AI SDK's `useCompletion` hook to render token-by-token.
 *
 * Auth: cookie-gated (the proxy doesn't cover `/api/*`, so we re-check
 * here). M5 polish: tie ownership to the cookie's user_id. For now any
 * logged-in seeded user can fetch any session's recap, which is fine
 * since the seeded auth is not a security boundary.
 *
 * `runtime = 'nodejs'` because lib/db (AWS SDK) and lib/haiku
 * (anthropic SDK) are both Node-only.
 */

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth';
import { getSession } from '@/lib/db';
import { summarize } from '@/lib/haiku';
import { findExpertById } from '@/lib/seed';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const expert = findExpertById(session.expert_id);
  const expertName = expert?.name ?? 'the expert';
  // We don't persist a topic field separately yet — synthesize one from
  // the expert's specialty so the LLM has a hook. M5 may store the
  // user's typed topic if we ever add a topic input box.
  const topic = expert?.specialty ?? 'PayPhone session';

  const result = summarize({
    transcript: session.transcript,
    topic,
    expertName,
  });

  // Plain text stream — the client uses `useCompletion` which speaks the
  // text protocol. (Distinct from the chat route, which uses the
  // UI-message protocol via `useChat`.)
  return result.toTextStreamResponse();
}
