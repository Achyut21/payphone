/**
 * PayPhone — Anthropic Haiku helpers (server/Node-only).
 *
 * Two streaming entry points:
 *   - `summarize(...)` — one-shot meeting recap (Topic / Key points /
 *     Action items / Open questions, in markdown). Used by the
 *     /api/sessions/[id]/recap GET route.
 *   - `chatWithContext(...)` — multi-turn chat with the transcript
 *     pinned as system context. Used by the
 *     /api/sessions/[id]/chat POST route.
 *
 * Both go through Vercel's AI SDK so we get token-by-token streaming for
 * free; the route handlers just return `result.toUIMessageStreamResponse()`
 * (chat) or `result.toTextStreamResponse()` (one-shot summary).
 *
 * Model: `claude-haiku-4-5` per CONTEXT.md's locked stack.
 *
 * Auth: relies on `process.env.ANTHROPIC_API_KEY` being set. The Vercel
 * SDK reads it implicitly via the `@ai-sdk/anthropic` provider.
 *
 * Never imported from a Client Component — the SDK is Node-only and
 * uses our API key.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { streamText, type UIMessage } from 'ai';

/** Locked per CONTEXT.md. M5+ may rotate. */
const HAIKU_MODEL = 'claude-haiku-4-5' as const;

/**
 * System prompt for the recap. Mirrors RESEARCH_DOSSIER §10's template,
 * tightened for markdown output and the small-call hackathon context.
 *
 * The four headings are intentional: they let the UI style each block
 * predictably (the markdown renderer doesn't need to special-case
 * anything; the LLM produces consistent output).
 */
const SUMMARY_SYSTEM = `You are PayPhone's session summarizer. PayPhone is a per-second video billing service; users pay a few cents per minute to talk to a human expert. After each call you write a concise, minutes-of-meeting style summary.

Output strict markdown with exactly these four sections, in this order:

## Topic
One sentence. What was the call about?

## Key points
3–5 short bullets (each one sentence). The most useful, specific things actually said. Never invent.

## Action items
0–4 bullets, each starting with a verb. Things one of the participants explicitly said they would do, or that follow obviously from the conversation. If there were none, write "None captured."

## Open questions
0–3 bullets. Things that came up but weren't resolved. If everything was resolved or the call was too short to have any, write "None."

Rules:
- Strict markdown only. No preamble, no closing line.
- If the transcript is sparse, low-confidence, or empty, say so under each section ("Too brief to capture key points" etc.) — do not pad.
- Use the transcript only. Do not infer participant identities or invent details.
- Preserve exact terms, numbers, and names from the transcript.
- Keep the whole summary under ~250 words.`;

/**
 * System prompt for the follow-up chat. The transcript is pinned in the
 * system message so every turn has it in context — the user doesn't
 * need to paste it repeatedly. The model is told to anchor every claim
 * to the transcript and to flag when something isn't covered.
 */
function buildChatSystem({
  topic,
  expertName,
  transcript,
}: {
  topic: string;
  expertName: string;
  transcript: string;
}): string {
  return `You are PayPhone's post-call assistant. The user just finished a paid video session with ${expertName}, topic: "${topic}". They may ask follow-up questions about the call.

Your context for this conversation is the transcript below. Use ONLY the transcript to answer. If the user asks about something not in the transcript, say "the call didn't cover that" rather than inventing.

Be concise. Markdown OK but optional. No preambles like "Based on the transcript…" — just answer.

--- TRANSCRIPT START ---
${transcript || '(empty: transcription was unavailable for this call)'}
--- TRANSCRIPT END ---`;
}

/** Format the DDB transcript array into a single string for the LLM. */
function joinTranscript(lines: readonly string[] | undefined): string {
  if (!lines || lines.length === 0) return '';
  return lines.join('\n');
}

/**
 * Stream a markdown summary of the call. Returns the AI SDK's StreamTextResult
 * — the route handler calls `.toTextStreamResponse()` to convert to a Web
 * Response with a streaming body. The `useCompletion` hook on the client
 * reads the stream chunk-by-chunk.
 */
export function summarize({
  transcript,
  topic,
  expertName,
}: {
  transcript: readonly string[] | undefined;
  topic: string;
  expertName: string;
}) {
  const transcriptText = joinTranscript(transcript);
  return streamText({
    model: anthropic(HAIKU_MODEL),
    system: SUMMARY_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Topic: ${topic}\nExpert: ${expertName}\n\nTranscript:\n${transcriptText || '(empty: transcription was unavailable for this call)'}`,
      },
    ],
    // Keep summaries tight — also caps the cost per call.
    maxOutputTokens: 600,
  });
}

/**
 * Stream a chat reply with the transcript pinned as system context. The
 * route handler calls `.toUIMessageStreamResponse()` to integrate with
 * the AI SDK's `useChat` React hook on the client.
 */
export function chatWithContext({
  messages,
  transcript,
  topic,
  expertName,
}: {
  messages: UIMessage[];
  transcript: readonly string[] | undefined;
  topic: string;
  expertName: string;
}) {
  // Flatten UIMessage `parts: [{ type, text }]` into plain {role, content}
  // shape expected by streamText. We only support text parts here — no
  // tool calls or attachments yet. Empty messages (no text parts) are
  // dropped so the model isn't asked about a blank user turn.
  const modelMessages = messages
    .map((m) => {
      if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') return null;
      const text = m.parts
        .map((p) => (p.type === 'text' ? p.text : ''))
        .filter((s) => s.length > 0)
        .join('');
      if (text.length === 0) return null;
      return { role: m.role, content: text } as const;
    })
    .filter((m): m is { role: 'user' | 'assistant' | 'system'; content: string } => m !== null);

  return streamText({
    model: anthropic(HAIKU_MODEL),
    system: buildChatSystem({
      topic,
      expertName,
      transcript: joinTranscript(transcript),
    }),
    messages: modelMessages,
    // Cap each turn — the user can ask another follow-up.
    maxOutputTokens: 600,
  });
}
