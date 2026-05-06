/**
 * PayPhone — marketplace (landing page after login).
 *
 * Server component. Greets the current user, lists the four seeded
 * experts in a responsive grid (2 cols ≥ md, 1 col < md). The "Talk to
 * <name>" buttons on the cards are wired in Phase 3 — for Phase 2 they
 * render as styled placeholders (disabled).
 *
 * The middleware in `middleware.ts` is the primary auth guard for this
 * page; the explicit `redirect('/login')` here is defense in depth.
 */

import { redirect } from 'next/navigation';

import { ExpertCard } from '@/components/ExpertCard';
import { getCurrentUser } from '@/lib/auth';
import { DEMO_EXPERTS } from '@/lib/seed';

export default async function MarketplacePage() {
  const user = await getCurrentUser();
  if (!user) {
    // Belt-and-suspenders: middleware should have caught this.
    redirect('/login');
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-12 sm:py-16">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-payphone-blue">
          Welcome, {user.name}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-payphone-ink sm:text-4xl">
          Pick someone to call.
        </h1>
        <p className="max-w-2xl text-base text-payphone-muted">
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
