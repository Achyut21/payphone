/**
 * PayPhone — login page (M4.5 redesign).
 *
 * Three demo personas; click sets the auth cookie and redirects to
 * `/marketplace`. Per CONTEXT.md the full Cognito flow is a deliberate
 * stretch goal, so this stays a cookie-write with no real auth.
 *
 * M4.5 visual treatment:
 *   - Aceternity `<Spotlight />` (conic gradients tinted to payphone-blue)
 *     bathes the page with a subtle moving glow.
 *   - Card centered, max-w-md, bg-payphone-surface, payphone-border.
 *   - Each persona is a full-width "card-style" button: avatar + name +
 *     tagline + animated arrow. Pending state via useFormStatus.
 *   - "← back to home" link in the top-left corner — `/` is the public
 *     marketing landing in M4.5.
 *
 * The pending state is in `<LoginPersonaButton />` (client). The
 * `loginAction` itself stays a server action defined inline.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, PhoneCall } from 'lucide-react';

import { LoginPersonaButton } from '@/components/LoginPersonaButton';
import { Spotlight } from '@/components/ui/spotlight-new';
import { setCurrentUser } from '@/lib/auth';
import { DEMO_USERS } from '@/lib/seed';

export const metadata = {
  title: 'PayPhone — sign in',
};

/**
 * Server action: set the auth cookie and redirect to the marketplace.
 *
 * The hidden `userId` field carries the choice; `setCurrentUser`
 * validates against the seed list and throws on an unknown id, so even
 * a hand-crafted POST can't sign in as someone not in `DEMO_USERS`.
 *
 * NOTE: `redirect()` works by throwing a `NEXT_REDIRECT` error — never
 * wrap this call in try/catch unless you re-throw that error. Plain
 * calls outside try blocks are safe.
 */
async function loginAction(formData: FormData): Promise<void> {
  'use server';
  const userId = formData.get('userId');
  if (typeof userId !== 'string') {
    throw new Error('login: missing userId');
  }
  await setCurrentUser(userId);
  redirect('/marketplace');
}

/**
 * Spotlight gradients tuned to payphone-blue. Hue 220° matches our
 * #0052FF token closely; opacities mirror the Aceternity defaults so
 * the glow stays subtle (it's behind the card, not the focal point).
 * The third gradient takes a touch of orange to keep the visual hook
 * consistent with the rest of the M4.5 palette.
 */
const SPOTLIGHT_GRADIENTS = {
  gradientFirst:
    'radial-gradient(68.54% 68.72% at 55.02% 31.46%, hsla(220, 100%, 70%, .10) 0, hsla(220, 100%, 50%, .04) 50%, hsla(220, 100%, 45%, 0) 80%)',
  gradientSecond:
    'radial-gradient(50% 50% at 50% 50%, hsla(220, 100%, 70%, .08) 0, hsla(220, 100%, 50%, .03) 80%, transparent 100%)',
  gradientThird:
    'radial-gradient(50% 50% at 50% 50%, hsla(16, 100%, 60%, .04) 0, hsla(16, 100%, 50%, .02) 80%, transparent 100%)',
} as const;

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-payphone-bg px-4 py-12 md:px-6">
      {/* Spotlight is absolute-positioned + pointer-events-none, so it
          sits behind everything without intercepting clicks. */}
      <Spotlight {...SPOTLIGHT_GRADIENTS} />

      {/* Back to home — top-left corner, doesn't compete with the navbar
          since the navbar already self-skips on no route, but keeps an
          obvious escape hatch right above the fold. */}
      <Link
        href="/"
        className="absolute left-4 top-24 z-20 inline-flex items-center gap-1.5 rounded-full border border-payphone-border bg-payphone-surface/60 px-3 py-1.5 text-sm text-payphone-ink-muted backdrop-blur-sm transition-colors hover:border-payphone-blue/40 hover:text-payphone-ink md:left-6 md:top-28"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to home
      </Link>

      {/* Card */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-payphone-border bg-payphone-surface/90 p-6 shadow-2xl shadow-black/40 backdrop-blur-md md:p-8">
        <header className="mb-6 flex flex-col items-center gap-3 text-center md:mb-8">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-payphone-blue" aria-hidden="true" />
            <span className="text-base font-semibold tracking-tight text-payphone-ink">
              PayPhone
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-payphone-ink md:text-3xl">
            Pick a demo persona.
          </h1>
          <p className="max-w-sm text-sm text-payphone-ink-muted md:text-base">
            Three seeded users, each pre-funded for the demo. No real auth — clicking a card signs
            you straight in.
          </p>
        </header>

        <div className="flex flex-col gap-3">
          {DEMO_USERS.map((user) => (
            <form key={user.id} action={loginAction}>
              <input type="hidden" name="userId" value={user.id} />
              <LoginPersonaButton user={user} />
            </form>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-payphone-ink-muted/70">
          Cognito + email is a stretch goal for M5. See{' '}
          <Link href="/docs" className="text-payphone-blue hover:underline">
            /docs
          </Link>{' '}
          for the rationale.
        </p>
      </div>
    </main>
  );
}
