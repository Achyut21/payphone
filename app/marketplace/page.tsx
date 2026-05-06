/**
 * PayPhone — marketplace.
 *
 * Logged-in expert browse, moved from `/` to `/marketplace` in M4.5 so
 * the root URL can host the marketing landing. Server component. Greets
 * the current user, lists the four seeded experts in a responsive grid
 * (1 col on mobile, 2 col on md, eventually 3 col on lg in Phase 6).
 *
 * The M4.5 proxy guards this path — see `proxy.ts`'s matcher. The
 * `redirect('/login')` here is defense in depth in case the proxy is
 * bypassed (it shouldn't be, but the seeded auth isn't a security
 * boundary anyway).
 *
 * Visual redesign — Aurora background, hover lift on cards, payphone-orange
 * rate badge, pending state on the "Talk to" CTA — comes in Phase 6.
 */

import { redirect } from 'next/navigation';

import { ExpertCard } from '@/components/ExpertCard';
import { getCurrentUser } from '@/lib/auth';
import { DEMO_EXPERTS } from '@/lib/seed';

export default async function MarketplacePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 pb-16 pt-28 sm:pt-32 md:pt-36">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-payphone-blue">
          Welcome, {user.name}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-payphone-ink sm:text-4xl">
          Pick someone to call.
        </h1>
        <p className="max-w-2xl text-base text-payphone-ink-muted">
          Per-second video billing, settled in one on-chain USDC transfer when you hang up.
          Authorize up to $5; pay only for the seconds you actually talk.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {DEMO_EXPERTS.map((expert) => (
          <ExpertCard key={expert.id} expert={expert} />
        ))}
      </section>
    </main>
  );
}
