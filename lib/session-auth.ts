/**
 * PayPhone — session ownership guards (M5 Phase 6).
 *
 * Every per-session resource (recap, chat, transcript, status, retry-
 * settle, plus the session/recap/timeout server pages) must enforce
 * `session_row.user_id === current_user.cognito_sub`. Without this guard
 * any logged-in user could fetch any session's transcript, chat history,
 * or recap by guessing/copying a session URL — a privacy hole that was
 * acceptable under M4's seeded auth but unacceptable now that real
 * users can sign up.
 *
 * Two flavors of the same check:
 *
 *   - `requireSessionOwner` for API routes. Returns either an
 *     `{ ok: true, row, user }` payload OR an `{ ok: false, response }`
 *     payload where `response` is a NextResponse the caller should
 *     return verbatim. The handler stays linear with no try/catch.
 *
 *   - `requireSessionOwnerForPage` for server components. Calls
 *     `redirect(...)` (which throws NEXT_REDIRECT, so the function never
 *     returns when not authorized). The page just calls it once at the
 *     top and proceeds with the returned `{ row, user }`.
 *
 * IMPORTANT — no existence leak: a session that exists but isn't owned
 * by the current user returns the SAME 404 as a session that doesn't
 * exist at all. A 403-vs-404 split would let an attacker enumerate
 * session ids by probing.
 *
 * Server-only module — `getCurrentUser` and `redirect` both pull in
 * `next/headers` / `next/navigation` which throw if used client-side.
 */

import 'server-only';

import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';

import { getCurrentUser, type AppUser } from '@/lib/auth';
import { getSession, type SessionRow } from '@/lib/db';

export type RequireSessionOwnerResult =
  | { ok: true; row: SessionRow; user: AppUser }
  | { ok: false; response: NextResponse };

/**
 * Auth + ownership gate for per-session API routes.
 *
 * Returns the session row (and current user) on success, or a
 * `NextResponse` to return verbatim on failure:
 *   - 401 if no Cognito session
 *   - 404 if the session row doesn't exist
 *   - 404 if the session row exists but is owned by a different user
 *
 * The 401 vs 404 split is intentional: we DO leak "you're not signed
 * in", because that's actionable for legitimate clients. We do NOT
 * leak "this session id exists but isn't yours" — same 404 as missing.
 */
export async function requireSessionOwner(sessionId: string): Promise<RequireSessionOwnerResult> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    };
  }
  const row = await getSession(sessionId);
  if (!row || row.user_id !== user.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'not_found' }, { status: 404 }),
    };
  }
  return { ok: true, row, user };
}

/**
 * Auth + ownership gate for server-component pages. Redirects on failure
 * (never returns); returns `{ row, user }` on success.
 *
 *   - Not signed in → `/login`
 *   - Signed in but session missing or not theirs → `redirectPath`
 *     (default `/marketplace`).
 *
 * `redirect()` throws NEXT_REDIRECT, so this must be called outside any
 * try/catch (or any catch must re-throw). TypeScript narrows correctly
 * because `redirect()` is typed as `never`.
 */
export async function requireSessionOwnerForPage(
  sessionId: string,
  redirectPath = '/marketplace',
): Promise<{ row: SessionRow; user: AppUser }> {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  const row = await getSession(sessionId);
  if (!row || row.user_id !== user.id) {
    redirect(redirectPath);
  }
  return { row, user };
}
