/**
 * GET /api/sessions/[id]/recap — streams an AI-generated summary of the
 * call.
 *
 * Reads the session's transcript + topic-equivalent (the expert name) from
 * DDB, calls Haiku, returns a streaming `Response`. The client uses the
 * AI SDK's `useCompletion` hook to render token-by-token.
 *
 * Auth: M5 ownership gate via `requireSessionOwner` — only the user
 * whose `cognito_sub` matches `session.user_id` can fetch the recap.
 * Non-owners (and unauthenticated requests) get a 404 (no existence
 * leak) / 401 respectively.
 *
 * `runtime = 'nodejs'` because lib/db (AWS SDK) and lib/haiku
 * (anthropic SDK) are both Node-only.
 */

import { NextResponse } from 'next/server';

import { summarize } from '@/lib/haiku';
import { findExpertById } from '@/lib/seed';
import { requireSessionOwner } from '@/lib/session-auth';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  const guard = await requireSessionOwner(id);
  if (!guard.ok) return guard.response;
  const { row: session } = guard;

  const expert = findExpertById(session.expert_id);
  const expertName = expert?.name ?? 'the expert';
  // We don't persist a topic field separately yet — synthesize one from
  // the expert's specialty so the LLM has a hook. M5 may store the
  // user's typed topic if we ever add a topic input box.
  const topic = expert?.specialty ?? 'PayPhone session';
  // M5.5: explicit specialty + duration are passed through to the
  // backup recap fallback. `summarize()` switches prompts when the
  // transcript is empty or sub-50-chars and uses these to generate a
  // coherent fallback recap. For sessions that predate `expert_id`
  // tracking, fall back to a generic specialty string.
  const expertSpecialty = expert?.specialty ?? 'general consulting';
  const durationSec = session.duration_sec ?? 0;

  const result = summarize({
    transcript: session.transcript,
    topic,
    expertName,
    expertSpecialty,
    durationSec,
  });

  // Plain text stream — the client uses `useCompletion` which speaks the
  // text protocol. (Distinct from the chat route, which uses the
  // UI-message protocol via `useChat`.)
  return result.toTextStreamResponse();
}
