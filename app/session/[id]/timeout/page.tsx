/**
 * PayPhone — session timeout page (M4.9).
 *
 * Renders when the session transitioned to TIMEOUT — i.e. 90 seconds
 * passed without the second participant (the expert) joining the room.
 *
 * Status branching:
 *   - row not found     → 404
 *   - TIMEOUT           → render the no-show page
 *   - AUTHORIZED/ACTIVE → bounce to live page (timeout not fired yet)
 *   - settled statuses  → bounce to recap (the call DID happen)
 *
 * The buyer's Permit2 authorization expires at its on-chain deadline
 * (30 min). No USDC moves on-chain.
 *
 * Visual: same AuroraBackground + card pattern as the recap for visual
 * continuity. The single "Back to marketplace" CTA gets the buyer
 * unblocked in one click.
 */

import { ArrowLeft, Clock } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AuroraBackground } from '@/components/ui/aurora-background';
import { requireSessionOwnerForPage } from '@/lib/session-auth';

type TimeoutPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TimeoutPage({ params }: TimeoutPageProps) {
  const { id } = await params;
  if (!id) notFound();

  // M5: ownership gate. Non-owners get bounced to /marketplace before
  // they see the timeout page, matching the rest of /session/[id]/*.
  const { row: session } = await requireSessionOwnerForPage(id);

  if (session.status === 'AUTHORIZED' || session.status === 'ACTIVE') {
    redirect(`/session/${session.session_id}`);
  }
  if (session.status === 'COMPLETED' || session.status === 'SETTLE_FAILED') {
    redirect(`/session/${session.session_id}/recap`);
  }

  return (
    <AuroraBackground className="min-h-screen flex-1" showRadialGradient={false}>
      <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-6 px-6 pb-20 pt-28 sm:pt-32 md:pt-36">
        <div className="flex flex-col gap-4 rounded-2xl border border-payphone-border bg-payphone-surface/80 p-8 backdrop-blur-md md:p-10">
          <div className="inline-flex w-fit items-center gap-1.5 rounded-full border border-payphone-orange/30 bg-payphone-orange/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-payphone-orange">
            <Clock className="h-3 w-3" aria-hidden="true" />
            Timed out
          </div>

          <h1 className="text-balance text-3xl font-semibold leading-tight text-payphone-ink md:text-4xl">
            No expert was available
          </h1>

          <p className="text-base leading-relaxed text-payphone-ink-muted">
            We waited 90 seconds for the other side to join, but no one showed up. Your
            authorization will expire on its own — no funds moved on-chain, and nothing settled.
          </p>

          <div className="mt-2 rounded-lg border border-payphone-border bg-payphone-bg/40 p-4">
            <p className="text-sm leading-relaxed text-payphone-ink-muted">
              Per-second billing only kicks in once both sides are in the room. You can{' '}
              <span className="font-medium text-payphone-ink">try a different expert</span> right
              away — there&apos;s nothing pending against your wallet.
            </p>
          </div>

          <Link
            href="/marketplace"
            className="mt-2 inline-flex w-fit items-center gap-2 rounded-lg bg-payphone-blue px-5 py-2.5 text-sm font-semibold text-payphone-ink shadow-md shadow-payphone-blue/20 transition-all hover:bg-payphone-blue/90 hover:shadow-lg hover:shadow-payphone-blue/30 md:text-base"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to marketplace
          </Link>
        </div>
      </main>
    </AuroraBackground>
  );
}
