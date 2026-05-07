/**
 * POST /api/experts/suggest — picks the best-matched seeded expert for
 * a free-form user query.
 *
 * The marketplace renders an `<ExpertSuggester />` input above the
 * grid; on submit we ship the user's text here, ask Haiku to pick one
 * of the four `DEMO_EXPERTS`, and return `{ expertId, reason }`. The
 * marketplace then highlights that card and scrolls it into view.
 *
 * Why direct `@anthropic-ai/sdk` rather than the Vercel AI SDK we use
 * in `lib/haiku.ts`: this is a one-shot non-streaming JSON response.
 * `streamText` is overkill — and we want strict JSON parsing, not a
 * markdown stream. The model is the same (`claude-haiku-4-5`).
 *
 * Auth: NextAuth-gated via `getCurrentUser()`. We don't pass the user
 * identity to the model — the suggestion is purely a function of the
 * query and the seeded expert list — but we do require a logged-in
 * session so unauthenticated traffic can't drive Haiku calls on our
 * dime.
 *
 * Robustness: the model is asked to reply with ONLY a JSON object.
 * We strip accidental markdown code fences before parsing, and we
 * VALIDATE that the returned `expertId` is one of the seeded ids
 * (defends against hallucinated ids). Any failure surfaces as a 502
 * with a generic `error` field; the client falls back to "pick from
 * the list below".
 */

import Anthropic from '@anthropic-ai/sdk';

import { getCurrentUser } from '@/lib/auth';
import { DEMO_EXPERTS } from '@/lib/seed';

export const runtime = 'nodejs';

/** Locked per CONTEXT.md. Same model as `lib/haiku.ts`. */
const MODEL = 'claude-haiku-4-5' as const;

/** Per-request payload cap. Free text is fine; novels are not. */
const MAX_QUERY_LENGTH = 500;

/** Cap the model output. ~200 tokens is plenty for `{id, reason}`. */
const MAX_OUTPUT_TOKENS = 200;

/**
 * Lazy-init so we don't construct the client at module load — keeps
 * `pnpm build` green when ANTHROPIC_API_KEY isn't set in the build
 * environment (the SDK throws in its constructor otherwise).
 */
let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

type SuggestRequest = { query?: unknown };
type SuggestSuccess = { expertId: string; reason: string };
type SuggestError = { error: string };

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: 'Unauthorized' } satisfies SuggestError, { status: 401 });
  }

  let body: SuggestRequest;
  try {
    body = (await req.json()) as SuggestRequest;
  } catch {
    return Response.json({ error: 'Invalid JSON' } satisfies SuggestError, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query.length === 0) {
    return Response.json({ error: 'Query required' } satisfies SuggestError, { status: 400 });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return Response.json({ error: 'Query too long' } satisfies SuggestError, { status: 400 });
  }

  // Build the expert list at request time (not module load) so the
  // model context stays in sync with `lib/seed.ts`. If a future change
  // edits the seed list, this regenerates automatically.
  const expertContext = DEMO_EXPERTS.map(
    (e) => `- id: "${e.id}", name: "${e.name}", specialty: "${e.specialty}", bio: "${e.bio}"`,
  ).join('\n');

  const systemPrompt = `You are helping a user pick the right expert from this list.

Available experts:
${expertContext}

The user will describe what they need help with. Pick the SINGLE best-matching expert.

Respond ONLY with valid JSON in this exact shape:
{"expertId": "<id from list>", "reason": "<one short sentence explaining why this expert matches>"}

Do not wrap in markdown code blocks. Do not include any other text. The expertId MUST be one of the ids listed above.`;

  try {
    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: query }],
    });

    // Concatenate text blocks; ignore non-text (tool-use, etc., which
    // shouldn't appear here but defensive).
    const text = response.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Strip any accidental code fences. Cheap defense: the prompt asks
    // for raw JSON, but Haiku occasionally wraps despite instructions.
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned) as { expertId?: unknown; reason?: unknown };

    if (typeof parsed.expertId !== 'string' || typeof parsed.reason !== 'string') {
      console.error('[suggest] malformed response shape', { text });
      return Response.json({ error: 'Suggestion failed' } satisfies SuggestError, { status: 502 });
    }

    // Validate the model's choice is real. Defends against
    // hallucinated/typo'd ids that the UI couldn't highlight anyway.
    const matched = DEMO_EXPERTS.find((e) => e.id === parsed.expertId);
    if (!matched) {
      console.error('[suggest] invalid expertId from model', { expertId: parsed.expertId });
      return Response.json({ error: 'Invalid expert match' } satisfies SuggestError, {
        status: 502,
      });
    }

    const result: SuggestSuccess = {
      expertId: matched.id,
      reason: parsed.reason.slice(0, 280),
    };
    return Response.json(result);
  } catch (err) {
    console.error('[suggest] failed', err);
    return Response.json({ error: 'Suggestion failed' } satisfies SuggestError, { status: 502 });
  }
}
