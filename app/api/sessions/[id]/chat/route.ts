/**
 * POST /api/sessions/[id]/chat — streams chat replies grounded in the
 * call transcript.
 *
 * The client (`useChat`) sends UI messages on each turn; we read the
 * transcript from DDB once per request, pin it as system context, and
 * stream Haiku's reply back. Multi-turn history is sent by the client
 * — we don't persist chat history (M5 polish if needed).
 *
 * Auth + runtime mirror /recap. Body shape mirrors useChat's default
 * (an array of UIMessages on `messages`).
 */

import { NextResponse } from 'next/server';
import { type UIMessage } from 'ai';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth';
import { getSession } from '@/lib/db';
import { chatWithContext } from '@/lib/haiku';
import { findExpertById } from '@/lib/seed';

export const runtime = 'nodejs';

/**
 * Body schema. We accept the AI SDK's default useChat shape:
 * `{ id?: string, messages: UIMessage[] }`. The schema only validates
 * that `messages` is an array — the SDK's UIMessage type is wide and
 * we trust the SDK's own client to produce valid shapes.
 */
const ChatBodySchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.unknown()).min(1),
});

export async function POST(
  request: Request,
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

  let body: z.infer<typeof ChatBodySchema>;
  try {
    body = ChatBodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', detail: err instanceof Error ? err.message : '' },
      { status: 400 },
    );
  }

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const expert = findExpertById(session.expert_id);
  const expertName = expert?.name ?? 'the expert';
  const topic = expert?.specialty ?? 'PayPhone session';

  const result = chatWithContext({
    messages: body.messages as UIMessage[],
    transcript: session.transcript,
    topic,
    expertName,
  });

  // UI-message stream — `useChat` reads this format, parsing each chunk
  // into the chat scrollback as text deltas + tool calls (we don't use
  // tools yet, but the protocol includes them).
  return result.toUIMessageStreamResponse();
}
