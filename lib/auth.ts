/**
 * PayPhone — auth helpers (M5 NextAuth-backed).
 *
 * `getCurrentUser()` is the single read-side abstraction the rest of the
 * app uses to ask "who is this request for?". It wraps NextAuth v5's
 * `auth()` and projects the JWT-backed session onto a tight `AppUser`
 * shape (id + email).
 *
 * History:
 *   - M4: cookie-based seeded login. Three seeded users; `getCurrentUser`
 *     read the cookie, looked up against `DEMO_USERS`, returned the row.
 *   - M5: replaced with Cognito + NextAuth. `id` is now the Cognito
 *     `sub`; the seeded user list is going away in Phase 4.
 *
 * The `setCurrentUser`/`clearCurrentUser` writers from M4 are gone —
 * NextAuth's `signIn`/`signOut` (re-exported from `@/auth`) replace them.
 *
 * Server-only module. The underlying `auth()` call uses `next/headers`,
 * which throws if invoked from a Client Component. All callers must be
 * Server Components, server actions, or route handlers.
 */

import 'server-only';

import { auth } from '@/auth';

export type AppUser = {
  /** Cognito `sub` — stable primary key, used as DDB hash for the user table. */
  id: string;
  /** Verified email — Cognito's `username_attribute`, always present. */
  email: string;
};

/**
 * Returns the current authenticated user, or null if no session exists
 * or the JWT is missing required fields. The proxy guards `/marketplace`
 * and `/session/*` so most app callers can assume the result is non-null,
 * but defensive null-handling is still good practice.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user || !user.id || !user.email) return null;
  return { id: user.id, email: user.email };
}
