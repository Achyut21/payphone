'use server';

/**
 * PayPhone — auth server actions.
 *
 * `logoutAction` is form-action wired in the navbar's user dropdown. It
 * clears the auth cookie via `lib/auth.ts:clearCurrentUser` and redirects
 * to the public marketing landing at `/`. The proxy guard then leaves
 * the user there (since `/` is public in M4.5).
 *
 * Note: `redirect()` works by throwing a `NEXT_REDIRECT` error — never
 * wrap this call in try/catch unless you re-throw that error. Plain
 * calls outside try blocks are safe.
 */

import { redirect } from 'next/navigation';

import { clearCurrentUser } from '@/lib/auth';

export async function logoutAction(): Promise<void> {
  await clearCurrentUser();
  redirect('/');
}
