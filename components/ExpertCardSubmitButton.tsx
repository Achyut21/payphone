'use client';

/**
 * PayPhone — ExpertCard submit button (M4.5 redesign).
 *
 * Client component split out of `<ExpertCard />` so it can call
 * `useFormStatus()`, the React 19 hook that exposes the parent
 * `<form action=...>`'s pending state. Pre-M4.5 the card had no
 * pending state at all (M4 deferred polish): clicking "Talk to" did
 * the full x402 round-trip server-side over ~5-10 seconds with no
 * visual feedback, which felt broken.
 *
 * On `pending`:
 *   - Replace the label with "Connecting..." + Loader2 spinner.
 *   - Disable the button so a double-click can't fire two server
 *     actions (which would burn two Permit2 nonces).
 *
 * The arrow-right icon translates 0.5rem on hover for the resting
 * state — small but a noticeable affordance.
 *
 * Tailwind `group-disabled` is not a stock variant, so we toggle the
 * arrow visibility with a conditional render rather than a CSS state.
 */

import { useFormStatus } from 'react-dom';
import { ArrowRight, Loader2 } from 'lucide-react';

export function ExpertCardSubmitButton({ firstName }: { firstName: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-payphone-blue px-4 py-2.5 text-sm font-semibold text-payphone-ink shadow-md shadow-payphone-blue/20 transition-all hover:bg-payphone-blue/90 hover:shadow-lg hover:shadow-payphone-blue/30 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:shadow-md md:text-base"
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Connecting…
        </>
      ) : (
        <>
          Talk to {firstName}
          <ArrowRight
            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </>
      )}
    </button>
  );
}
