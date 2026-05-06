/**
 * PayPhone — public marketing landing (M4.5).
 *
 * Replaces the M4 marketplace at this path. The marketplace itself moved
 * to `/marketplace`; the M4.5 proxy makes `/` public so unauthenticated
 * visitors can read the pitch before clicking through.
 *
 * Sections (top → bottom):
 *   1. Hero — Aceternity Background Beams with Collision (recolored to
 *      payphone-blue beams + payphone-orange collision flash). Headline,
 *      subhead, "Get started" + "View live demo" CTAs.
 *   2. How it works — three numbered cards (browse / talk / settle).
 *   3. Live last-call widget — server-rendered DDB Scan for the most
 *      recent COMPLETED session. Falls back to the M4 canonical demo tx
 *      if DDB is empty or unreachable.
 *   4. "Built on" — six tech stack badges (Base, CDP, x402, Daily,
 *      AWS, Next.js).
 *   5. Expert preview — first three seeded experts with a "see all"
 *      link routing to /marketplace (logged-in) or /login (logged-out).
 *
 * Server Component. `revalidate = 30` so the live widget Scan against
 * DDB runs at most every 30 seconds across all visitors.
 */

import Link from 'next/link';
import { ArrowRight, Coins, ExternalLink, Users, Video } from 'lucide-react';

import { ExpertCard } from '@/components/ExpertCard';
import { BackgroundBeamsWithCollision } from '@/components/ui/background-beams-with-collision';
import { getCurrentUser } from '@/lib/auth';
import { BASESCAN_TX_BASE_URL } from '@/lib/constants';
import { getLatestCompletedSession } from '@/lib/db';
import { DEMO_EXPERTS } from '@/lib/seed';

/** Revalidate cached HTML every 30s so the live widget Scan stays fresh. */
export const revalidate = 30;

/**
 * M4 canonical demo session — fallback for the live widget when DDB is
 * empty / unreachable. Recorded in `docs/m4-tx.txt`. Not bigint because
 * we only display formatted strings.
 */
const FALLBACK_LAST_CALL = {
  durationSec: 84,
  settledUsd: '0.84',
  txHash: '0x47dab9fe331741037730c4da1e1c1d46f2cfd5309db4311b3d57745739d6e33a',
} as const;

export default async function LandingPage() {
  const [user, lastCall] = await Promise.all([
    getCurrentUser(),
    // Best-effort: DDB hiccup falls back to the static M4 demo line.
    getLatestCompletedSession().catch(() => null),
  ]);

  const seeAllHref = user ? '/marketplace' : '/login';

  return (
    <main className="flex flex-1 flex-col">
      <Hero lastCallTxHash={lastCall?.settle_tx_hash ?? FALLBACK_LAST_CALL.txHash} />
      <HowItWorks />
      <LiveLastCall row={lastCall} />
      <BuiltOn />
      <ExpertPreview seeAllHref={seeAllHref} />
    </main>
  );
}

/* ---------- Hero ---------- */

function Hero({ lastCallTxHash }: { lastCallTxHash: string }) {
  const liveDemoUrl = `${BASESCAN_TX_BASE_URL}${lastCallTxHash}`;

  return (
    <BackgroundBeamsWithCollision className="min-h-[85vh] md:min-h-[90vh]">
      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-24 text-center md:gap-8 md:py-32 md:px-8">
        {/* Eyebrow tag */}
        <div className="inline-flex items-center gap-2 rounded-full border border-payphone-border bg-payphone-surface/60 px-3 py-1 text-xs font-medium text-payphone-ink-muted backdrop-blur-sm md:text-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-payphone-orange" />
          Live on Base Sepolia · mainnet at demo
        </div>

        {/* Headline */}
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-payphone-ink md:text-6xl lg:text-7xl">
          Per-second video calls.
          <br />
          <span className="bg-gradient-to-r from-payphone-blue via-payphone-blue to-payphone-orange bg-clip-text text-transparent">
            Settled on-chain.
          </span>
        </h1>

        {/* Subhead */}
        <p className="max-w-2xl text-pretty text-base leading-relaxed text-payphone-ink-muted md:text-lg">
          Pay an expert by the second. Authorize once, settle for what you used. One USDC transfer
          on Base when you hang up — no recurring billing, no minimum charge, no Stripe.
        </p>

        {/* CTAs */}
        <div className="mt-2 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-payphone-blue px-6 py-3 text-base font-semibold text-payphone-ink shadow-lg shadow-payphone-blue/30 transition-all hover:bg-payphone-blue/90 hover:shadow-xl hover:shadow-payphone-blue/40"
          >
            Get started
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <a
            href={liveDemoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-payphone-border bg-payphone-surface/60 px-6 py-3 text-base font-medium text-payphone-ink backdrop-blur-sm transition-colors hover:border-payphone-orange/50 hover:bg-payphone-surface-elevated"
          >
            View live demo
            <ExternalLink className="h-4 w-4 text-payphone-orange" aria-hidden="true" />
          </a>
        </div>

        {/* Pitch tagline */}
        <p className="mt-4 text-xs text-payphone-ink-muted/70 md:text-sm">
          Stripe&apos;s 30¢ + 2.9% minimum makes per-second billing impossible. x402 + Permit2 makes
          it one transaction.
        </p>
      </div>
    </BackgroundBeamsWithCollision>
  );
}

/* ---------- How it works ---------- */

const HOW_IT_WORKS_STEPS = [
  {
    n: '1',
    icon: Users,
    title: 'Browse experts',
    body: 'Pick a Solidity dev, a UX consultant, anyone with the answer.',
  },
  {
    n: '2',
    icon: Video,
    title: 'Talk live',
    body: 'Authorize up to $5 with one signature. The clock starts when the call connects.',
  },
  {
    n: '3',
    icon: Coins,
    title: 'Settle on-chain',
    body: 'When you hang up, only the actual seconds are billed. One Base mainnet tx.',
  },
] as const;

function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto w-full max-w-6xl px-4 py-20 md:px-8 md:py-28">
      <div className="mb-12 flex flex-col items-center gap-3 text-center md:mb-16">
        <p className="text-xs font-semibold uppercase tracking-wider text-payphone-blue md:text-sm">
          How it works
        </p>
        <h2 className="text-3xl font-semibold tracking-tight text-payphone-ink md:text-4xl">
          Three steps. One transaction.
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
        {HOW_IT_WORKS_STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <div
              key={step.n}
              className="group relative flex flex-col gap-4 rounded-2xl border border-payphone-border bg-payphone-surface p-6 transition-colors hover:border-payphone-blue/40 md:p-8"
            >
              {/* Number badge */}
              <div className="flex items-center justify-between">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-payphone-blue/10 text-sm font-semibold text-payphone-blue">
                  {step.n}
                </span>
                <Icon
                  className="h-5 w-5 text-payphone-ink-muted transition-colors group-hover:text-payphone-orange"
                  aria-hidden="true"
                />
              </div>
              <h3 className="text-lg font-semibold text-payphone-ink md:text-xl">{step.title}</h3>
              <p className="text-sm leading-relaxed text-payphone-ink-muted md:text-base">
                {step.body}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Live last-call widget (server-rendered) ---------- */

function LiveLastCall({ row }: { row: Awaited<ReturnType<typeof getLatestCompletedSession>> }) {
  // Decide what to render: live row, or fallback to the M4 canonical demo.
  const live = row !== null;
  const durationSec = live ? Math.floor(row.duration_sec ?? 0) : FALLBACK_LAST_CALL.durationSec;
  const settledAtomic = live ? (row.settled_amount ?? 0) : 840_000;
  const settledUsd = live ? (settledAtomic / 1_000_000).toFixed(2) : FALLBACK_LAST_CALL.settledUsd;
  const txHash = live ? (row.settle_tx_hash ?? '') : FALLBACK_LAST_CALL.txHash;
  const txUrl = `${BASESCAN_TX_BASE_URL}${txHash}`;

  return (
    <section className="mx-auto w-full max-w-4xl px-4 pb-20 md:px-8 md:pb-24">
      <a
        href={txUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex flex-col gap-4 rounded-2xl border border-payphone-border bg-payphone-surface p-6 transition-all hover:border-payphone-orange/50 hover:bg-payphone-surface-elevated md:flex-row md:items-center md:justify-between md:p-8"
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-payphone-success' : 'bg-payphone-ink-muted/60'}`}
              aria-hidden="true"
            />
            <span className="text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted">
              {live ? 'Last call · live' : 'Demo call · canonical'}
            </span>
          </div>
          <p className="text-2xl font-semibold tracking-tight text-payphone-ink md:text-3xl">
            <span className="font-mono text-payphone-blue">{durationSec}s</span>
            <span className="mx-3 text-payphone-ink-muted/50">→</span>
            <span className="font-mono text-payphone-success">${settledUsd}</span>
            <span className="ml-2 text-base font-normal text-payphone-ink-muted md:text-lg">
              settled on-chain
            </span>
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 self-start rounded-full bg-payphone-orange/10 px-4 py-2 text-sm font-medium text-payphone-orange transition-colors group-hover:bg-payphone-orange/15 md:self-auto">
          View on BaseScan
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </div>
      </a>
    </section>
  );
}

/* ---------- Built on (tech stack badges) ---------- */

const STACK = [
  { name: 'Base', href: 'https://base.org' },
  { name: 'Coinbase CDP', href: 'https://www.coinbase.com/developer-platform' },
  { name: 'x402', href: 'https://www.x402.org' },
  { name: 'Daily.co', href: 'https://www.daily.co' },
  { name: 'AWS', href: 'https://aws.amazon.com' },
  { name: 'Next.js', href: 'https://nextjs.org' },
] as const;

function BuiltOn() {
  return (
    <section className="border-y border-payphone-border bg-payphone-surface/30 py-12 md:py-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 md:px-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted">
          Built on
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3">
          {STACK.map((item) => (
            <a
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-payphone-border bg-payphone-surface px-4 py-2 text-sm font-medium text-payphone-ink-muted transition-all hover:border-payphone-blue/50 hover:bg-payphone-surface-elevated hover:text-payphone-ink md:px-5 md:py-2.5 md:text-base"
            >
              {item.name}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Expert preview ---------- */

function ExpertPreview({ seeAllHref }: { seeAllHref: string }) {
  // First three seeded experts. The fourth shows up on /marketplace.
  const previewExperts = DEMO_EXPERTS.slice(0, 3);

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-20 md:px-8 md:py-28">
      <div className="mb-10 flex flex-col items-start justify-between gap-3 md:mb-12 md:flex-row md:items-end">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-payphone-blue md:text-sm">
            Experts on call
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-payphone-ink md:text-4xl">
            Real people. Per-second pricing.
          </h2>
        </div>
        <Link
          href={seeAllHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-payphone-blue transition-colors hover:text-payphone-orange md:text-base"
        >
          See all experts
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
        {previewExperts.map((expert) => (
          <ExpertCard key={expert.id} expert={expert} />
        ))}
      </div>
    </section>
  );
}
