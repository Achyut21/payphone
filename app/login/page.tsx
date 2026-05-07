/**
 * PayPhone — login page (M5 Cognito redesign).
 *
 * One button: "Continue with email". Clicking it kicks off the standard
 * NextAuth code-flow handshake against AWS Cognito Hosted UI — Cognito
 * handles signup, signin, password recovery, and email-verification
 * screens for us. We don't render any of those.
 *
 * Visual treatment (carried over from M4.5):
 *   - Aceternity `<Spotlight />` (conic gradients tinted to payphone-blue
 *     and a touch of payphone-orange) bathes the page in a subtle moving
 *     glow.
 *   - Card centered, max-w-md, bg-payphone-surface, payphone-border.
 *   - "← Back to home" pinned top-left below the navbar.
 *
 * The signin button itself is a server-action form so the redirect flow
 * happens server-side (no client JS needed for the auth round-trip).
 */

import Link from 'next/link';
import { ArrowLeft, ArrowRight, PhoneCall } from 'lucide-react';

import { signIn } from '@/auth';
import { Spotlight } from '@/components/ui/spotlight-new';

export const metadata = {
  title: 'PayPhone — sign in',
};

/**
 * Server action: hand off to NextAuth's Cognito provider. NextAuth
 * resolves the OIDC discovery doc, redirects the user to Cognito's
 * `/oauth2/authorize` (Hosted UI), and on successful return brings
 * them back via `/api/auth/callback/cognito` and finally `redirectTo`.
 *
 * `redirect()` flows happen by throwing — never wrap this in try/catch
 * unless the catch re-throws.
 */
async function loginAction(): Promise<void> {
  'use server';
  await signIn('cognito', { redirectTo: '/marketplace' });
}

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
      <Spotlight {...SPOTLIGHT_GRADIENTS} />

      <Link
        href="/"
        className="absolute left-4 top-24 z-20 inline-flex items-center gap-1.5 rounded-full border border-payphone-border bg-payphone-surface/60 px-3 py-1.5 text-sm text-payphone-ink-muted backdrop-blur-sm transition-colors hover:border-payphone-blue/40 hover:text-payphone-ink md:left-6 md:top-28"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to home
      </Link>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-payphone-border bg-payphone-surface/90 p-6 shadow-2xl shadow-black/40 backdrop-blur-md md:p-8">
        <header className="mb-6 flex flex-col items-center gap-3 text-center md:mb-8">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-payphone-blue" aria-hidden="true" />
            <span className="text-base font-semibold tracking-tight text-payphone-ink">
              PayPhone
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-payphone-ink md:text-3xl">
            Sign in to PayPhone
          </h1>
          <p className="max-w-sm text-sm text-payphone-ink-muted md:text-base">
            We&apos;ll send you to AWS Cognito to sign in or create an account. Email + password,
            verified by code.
          </p>
        </header>

        <form action={loginAction}>
          <button
            type="submit"
            className="group flex w-full items-center justify-between rounded-xl bg-payphone-blue px-5 py-3.5 text-base font-semibold text-payphone-ink shadow-lg shadow-payphone-blue/30 transition-all hover:bg-payphone-blue/90 hover:shadow-payphone-blue/40"
          >
            <span>Continue with email</span>
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-payphone-ink-muted/70">
          By continuing you agree to PayPhone&apos;s hackathon terms (it&apos;s a demo). See{' '}
          <Link href="/docs" className="text-payphone-blue hover:underline">
            /docs
          </Link>{' '}
          for what we collect.
        </p>
      </div>
    </main>
  );
}
