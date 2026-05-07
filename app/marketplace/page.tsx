/**
 * PayPhone — marketplace (M4.5).
 *
 * Logged-in expert browse, moved from `/` to `/marketplace` in Phase 3
 * so the root URL can host the marketing landing. The proxy guards
 * this path; `redirect('/login')` here is defense in depth.
 *
 * Phase 6 redesign:
 *   - Wrapped in `<AuroraBackground />` (Aceternity, recolored to fade
 *     payphone-blue → payphone-orange in `components/ui/aurora-
 *     background.tsx`). Subtle slow-drifting haze behind the cards.
 *   - Grid bumped from `1 / 2` cols to `1 / 2 / 3` so all four experts
 *     fit nicely on `lg:` (3 across, 1 below) without leaving a
 *     gaping right-side margin on wide monitors.
 *   - The `<ExpertCard />` itself was redesigned in Phase 3 — hover
 *     lift, payphone-orange rate badge, arrow-right icon, pending
 *     state on the submit button via `useFormStatus()`. No further
 *     changes needed here.
 */

import { redirect } from 'next/navigation';

import { AuroraBackground } from '@/components/ui/aurora-background';
import { MarketplaceClient } from '@/components/MarketplaceClient';
import { WalletPanel } from '@/components/WalletPanel';
import { getCurrentUser } from '@/lib/auth';
import { DEMO_EXPERTS } from '@/lib/seed';

export default async function MarketplacePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  // Friendly handle from the verified email — shown only as a greeting.
  const greeting = user.email.includes('@')
    ? user.email.slice(0, user.email.indexOf('@'))
    : user.email;

  return (
    <AuroraBackground className="min-h-screen flex-1">
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 pb-20 pt-28 sm:pt-32 md:pt-36">
        <header className="flex flex-col gap-2">
          <p className="text-sm font-medium uppercase tracking-wide text-payphone-blue">
            Welcome, {greeting}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-payphone-ink sm:text-4xl md:text-5xl">
            Pick someone to call.
          </h1>
          <p className="max-w-2xl text-base text-payphone-ink-muted md:text-lg">
            Per-second video billing, settled in one on-chain USDC transfer when you hang up.
            Authorize up to $5; pay only for the seconds you actually talk.
          </p>
        </header>

        {/* Wallet panel — live USDC balance + faucet button when low.
            Sits between the headline and the expert grid so users see
            their funding state before clicking through to a session. */}
        <WalletPanel />

        {/* M5.5: client wrapper holds the AI-suggester state. The
            suggester input mounts above the grid; on submit it picks
            one of the seeded experts and the matching ExpertCard
            renders a "Suggested" badge + scrolls itself into view. */}
        <MarketplaceClient experts={DEMO_EXPERTS} />
      </main>
    </AuroraBackground>
  );
}
