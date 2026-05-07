'use server';

/**
 * PayPhone — auth server actions.
 *
 * `logoutAction` is form-action wired in the navbar's user dropdown. M5:
 * delegates to NextAuth's `signOut`, which clears the JWT cookie and
 * redirects to the public landing at `/`. The proxy then leaves the
 * user there since `/` is public.
 *
 * NextAuth's `signOut` performs the redirect itself by throwing a
 * `NEXT_REDIRECT` error — same mechanism as Next's `redirect()`, so it
 * must be called outside any try/catch block (or the catch must
 * re-throw the error).
 */

import { signOut } from '@/auth';

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: '/' });
}
