'use client';

/**
 * PayPhone — login page persona button (M4.5).
 *
 * Client component split out of `<LoginPage />` so it can read
 * `useFormStatus()`. The parent `<form action={loginAction}>` writes
 * the auth cookie and redirects to /marketplace; while that's in flight
 * we swap the button label to "Signing in..." and disable the button.
 *
 * The redirect itself is fast (cookie write → 303), but disabling the
 * button still matters: a fast double-click would otherwise queue a
 * second action against an already-set cookie. Innocuous, but feels
 * sloppy.
 *
 * Visual style mirrors the M4.5 ExpertCardSubmitButton: hover lift,
 * payphone-blue bg with shadow, arrow-right icon translates on hover.
 */

import { useFormStatus } from 'react-dom';
import { ArrowRight, Loader2 } from 'lucide-react';

import { avatarUrl } from '@/lib/avatar';
import type { DemoUser } from '@/lib/seed';

export function LoginPersonaButton({ user }: { user: DemoUser }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="group flex w-full items-center gap-4 rounded-xl border border-payphone-border bg-payphone-surface-elevated p-4 text-left transition-all hover:-translate-y-0.5 hover:border-payphone-blue/50 hover:bg-payphone-surface-elevated/80 hover:shadow-lg hover:shadow-payphone-blue/10 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-none"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatarUrl(user.avatarSeed, { backgroundColor: '0a0a0a' })}
        alt=""
        width={48}
        height={48}
        className="h-12 w-12 shrink-0 rounded-full ring-1 ring-payphone-border"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold text-payphone-ink">Continue as {user.name}</span>
        <span className="truncate text-sm text-payphone-ink-muted">{user.tagline}</span>
      </div>
      {pending ? (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-payphone-blue" aria-hidden="true" />
      ) : (
        <ArrowRight
          className="h-5 w-5 shrink-0 text-payphone-ink-muted transition-all group-hover:translate-x-0.5 group-hover:text-payphone-blue"
          aria-hidden="true"
        />
      )}
    </button>
  );
}
