/**
 * PayPhone — session server actions.
 *
 * Marketplace clicks land here. The action runs the entire x402 round-
 * trip server-side via `requestSession` (which posts back to this same
 * Next dev server's `/api/sessions`), then redirects to the live
 * session page.
 *
 * Why a server action and not a client `useTransition` + fetch:
 *   - Keeps wallet/CDP secrets off the client (server-side env only).
 *   - One round-trip from the browser POV — submit → server does
 *     402+sign+201 internally → 303 redirect to /session/[id].
 *   - No client JS needed for the marketplace, so the cards stay as a
 *     pure server component (avatars + Lucide icons rendered server-
 *     side) and the form action drives everything.
 *
 * Latency: ~5-10 seconds end-to-end (CDP signTypedData + facilitator
 * verify + Daily room creation + DDB write). Browser shows the previous
 * page during that time. M4 deferred polish: a loading button state.
 *
 * Per CONTEXT.md, this whole module is `runtime = 'nodejs'`-equivalent
 * (server actions inherit Node runtime). Do NOT import from a Client
 * Component.
 */

'use server';

import { redirect } from 'next/navigation';

import { requestSession } from '@/lib/agent';
import { getCurrentUser } from '@/lib/auth';
import { findExpertById } from '@/lib/seed';

/**
 * Start a paid video session with the given expert.
 *
 * Wired into ExpertCard's `<form action={startSession}>` — the form
 * carries `expertId` as a hidden input so this single action handles
 * all four cards.
 *
 * Failures throw, which surfaces as the Next default error page in dev.
 * M5 polish should map common cases (insufficient funds, facilitator
 * down, Daily quota exceeded) to friendlier UI states.
 */
export async function startSession(formData: FormData): Promise<void> {
  const expertId = formData.get('expertId');
  if (typeof expertId !== 'string' || expertId.length === 0) {
    throw new Error('startSession: missing expertId');
  }
  const expert = findExpertById(expertId);
  if (!expert) {
    throw new Error(`startSession: unknown expertId=${expertId}`);
  }

  const user = await getCurrentUser();
  if (!user) {
    // Cookie expired between page render and submit — bounce to login
    // instead of running the round-trip with a sentinel user id.
    redirect('/login');
  }

  const result = await requestSession({
    topic: `Call with ${expert.name} — ${expert.specialty}`,
    expertId: expert.id,
    userId: user.id,
  });

  // `redirect` throws NEXT_REDIRECT — must be outside try/catch.
  redirect(`/session/${result.sessionId}`);
}
