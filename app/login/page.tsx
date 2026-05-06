/**
 * PayPhone — login page.
 *
 * No real auth: three buttons, click sets a cookie, redirect to `/`.
 * Per CONTEXT.md the full Cognito flow is a deliberate stretch goal.
 *
 * Server-side form actions handle the cookie write — no client JS
 * needed for login itself. Avatars are served from DiceBear's hosted
 * API (see lib/avatar.ts for why we don't run the lib locally).
 */

import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { setCurrentUser } from '@/lib/auth';
import { avatarUrl } from '@/lib/avatar';
import { DEMO_USERS } from '@/lib/seed';

/**
 * Server action: set the auth cookie and redirect to the marketplace.
 *
 * The hidden `userId` field carries the choice; `setCurrentUser` validates
 * against the seed list and throws on an unknown id, so even a hand-
 * crafted POST can't sign in as someone not in `DEMO_USERS`.
 *
 * NOTE: `redirect()` works by throwing a `NEXT_REDIRECT` error — never
 * wrap this call in try/catch unless you re-throw that error. Plain calls
 * outside try blocks are safe.
 */
async function loginAction(formData: FormData): Promise<void> {
  'use server';
  const userId = formData.get('userId');
  if (typeof userId !== 'string') {
    throw new Error('login: missing userId');
  }
  await setCurrentUser(userId);
  // Redirect target moved from `/` to `/marketplace` in M4.5: the root URL
  // is now the public marketing landing, the marketplace is the post-login
  // home for authenticated users.
  redirect('/marketplace');
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-payphone-bg p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-semibold tracking-tight text-payphone-ink">
            PayPhone
          </CardTitle>
          <CardDescription className="text-payphone-muted">
            Per-second video calls, settled on Base. Pick a demo user to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {DEMO_USERS.map((user) => {
            const avatar = avatarUrl(user.avatarSeed);
            return (
              <form key={user.id} action={loginAction}>
                <input type="hidden" name="userId" value={user.id} />
                <Button
                  type="submit"
                  size="lg"
                  className="h-14 w-full justify-start gap-3 bg-payphone-blue text-white hover:bg-payphone-blue/90"
                >
                  {/* Inline <img>: tiny SVG from DiceBear's CDN. Next/Image isn't worth the LCP overhead. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatar}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 rounded-full bg-payphone-surface"
                  />
                  <span className="text-base font-medium">Continue as {user.name}</span>
                </Button>
              </form>
            );
          })}
        </CardContent>
      </Card>
    </main>
  );
}
