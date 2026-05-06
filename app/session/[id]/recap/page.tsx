/**
 * PayPhone — recap page (server component).
 *
 * Renders after the call has settled. Fetches the session row, formats
 * the relevant fields, and hands them to the `<Recap>` client component.
 * The actual streaming summary + chat live there because they need the
 * AI SDK's React hooks.
 *
 * Status branching:
 *   - row not found             → 404
 *   - status still AUTHORIZED    → bounce back to live page (the user
 *                                  shouldn't see a "settled" page for
 *                                  an unsettled call)
 *   - status COMPLETED            → render normally
 *   - status SETTLE_FAILED       → render with the failure surfaced in
 *                                  the badge area (still useful for the
 *                                  user to see the transcript/recap)
 *
 * M4.5 layout: wrapped in `<AuroraBackground showRadialGradient={false}>`
 * for an even payphone-blue → payphone-orange haze across the whole
 * page. The recap content is denser than the marketplace so we don't
 * want the radial mask leaving half the page un-aurora'd. Navbar still
 * shows on this route (Phase 2's regex `/^\/session\/[^/]+\/?$/` only
 * skips on `/session/<id>`); the footer skips on any `/session/*` so
 * the recap ends with its own back-to-marketplace CTA, not a sprawling
 * site footer.
 */

import { notFound, redirect } from 'next/navigation';

import { Recap } from '@/components/Recap';
import { AuroraBackground } from '@/components/ui/aurora-background';
import { BASESCAN_TX_BASE_URL } from '@/lib/constants';
import { getSession } from '@/lib/db';
import { findExpertById } from '@/lib/seed';

type RecapPageProps = {
  params: Promise<{ id: string }>;
};

/** USDC has 6 decimals; format atomic to dollars-cents. */
function formatUsd(atomic: number | undefined): string {
  if (atomic === undefined || atomic === null) return '$0.00';
  const dollars = Math.floor(atomic / 1_000_000);
  const cents = Math.floor((atomic % 1_000_000) / 10_000)
    .toString()
    .padStart(2, '0');
  return `$${dollars}.${cents}`;
}

export default async function RecapPage({ params }: RecapPageProps) {
  const { id } = await params;
  if (!id) notFound();

  const session = await getSession(id);
  if (!session) notFound();

  // The call hasn't settled yet — the user shouldn't see a recap of an
  // unsettled call. Bounce them back to the live page so they can wait
  // for `meeting.ended` to fire.
  if (session.status === 'AUTHORIZED' || session.status === 'ACTIVE') {
    redirect(`/session/${session.session_id}`);
  }

  const expert = findExpertById(session.expert_id);
  const expertName = expert?.name ?? 'the expert';
  const expertSpecialty = expert?.specialty ?? 'Live consultation';

  const settledUsd = formatUsd(session.settled_amount);
  const settleTxUrl = session.settle_tx_hash
    ? `${BASESCAN_TX_BASE_URL}${session.settle_tx_hash}`
    : null;
  const durationSec = session.duration_sec ?? 0;
  const settleFailed = session.status === 'SETTLE_FAILED';

  return (
    <AuroraBackground className="min-h-screen flex-1" showRadialGradient={false}>
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 pb-20 pt-28 sm:pt-32 md:pt-36">
        <Recap
          sessionId={session.session_id}
          expertName={expertName}
          expertSpecialty={expertSpecialty}
          settledUsd={settledUsd}
          settleTxUrl={settleTxUrl}
          durationSec={durationSec}
          settleFailed={settleFailed}
          hasTranscript={(session.transcript?.length ?? 0) > 0}
        />
      </main>
    </AuroraBackground>
  );
}
