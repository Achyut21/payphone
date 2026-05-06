/**
 * PayPhone — fake auth helpers.
 *
 * Cookie-based "login" with three seeded users. No real auth provider, no
 * password, no JWT — just a cookie holding a user id. Per CONTEXT.md the
 * full Cognito flow is a stretch goal; this is the deliberate
 * fake-but-secure pattern for the hackathon.
 *
 * Why httpOnly: the cookie can't be read or tampered with from client JS,
 * so even though the contents are non-sensitive (just "alice" / "bob" /
 * "charlie"), there's no XSS path to spoof someone else.
 *
 * Server-only module. Imports `next/headers`, which throws if called from
 * a Client Component. All callers must be Server Components, server
 * actions, or route handlers.
 */

import 'server-only';
import { cookies } from 'next/headers';

import { DEMO_USERS, findUserById, type DemoUser } from '@/lib/seed';

const COOKIE_NAME = 'payphone_user';
/** ~30 days. The cookie is non-sensitive so a long TTL is fine. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Returns the current logged-in user, or null if the cookie is absent or
 * holds an unknown id (e.g. seeded data changed between sessions).
 *
 * Async because Next 15+ made `cookies()` async — calling it synchronously
 * is a hard error at runtime.
 */
export async function getCurrentUser(): Promise<DemoUser | null> {
  const cookieStore = await cookies();
  const rawId = cookieStore.get(COOKIE_NAME)?.value;
  return findUserById(rawId);
}

/**
 * Set the auth cookie to the given user id. Throws if the id isn't one of
 * the seeded users — login server actions pass a known id from the radio
 * buttons, so this is a defense against a tampered request body.
 */
export async function setCurrentUser(userId: string): Promise<void> {
  const user = findUserById(userId);
  if (!user) {
    throw new Error(`Unknown user id: ${userId}`);
  }
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, user.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

/** Clear the auth cookie. */
export async function clearCurrentUser(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/** Re-export for convenience so callers don't need both lib/auth and lib/seed. */
export { DEMO_USERS };
