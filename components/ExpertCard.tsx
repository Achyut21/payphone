'use client';

/**
 * PayPhone — expert marketplace card (M4.5 redesign + M5.5 suggester).
 *
 * Originally a server component; converted to a Client Component in
 * M5.5 so it can read the `isSuggested` / `suggestedReason` props
 * (driven by the AI expert suggester via `<MarketplaceClient />`)
 * and run the `useEffect` that scrolls itself into view when picked.
 *
 * Server-action interop: the "Talk to" button still wraps a
 * `<form action={startSession}>`. Next.js routes server actions
 * called from Client Components as RPC, so the conversion is
 * transparent to the buyer-agent flow.
 *
 * The "Talk to" button lives in `<ExpertCardSubmitButton />` so it
 * can read the parent form's pending state via `useFormStatus()`.
 *
 * Visual changes from M4:
 *   - Background `bg-payphone-surface` (now near-black per the M4.5
 *     palette flip, was paper-white in M4).
 *   - Hover lift: `-translate-y-0.5` plus shadow, border tints to
 *     `payphone-blue/40`.
 *   - Rate badge moved from blue/10 + blue text to orange/10 + orange
 *     text — same orange as the "ON AIR" badge, the BaseScan icon, and
 *     the live activity indicators on the landing.
 *   - "Talk to <name>" CTA gets a Lucide arrow-right icon that
 *     translates 0.5rem on hover.
 *
 * M5.5 additions:
 *   - When `isSuggested` is true the card border tints
 *     payphone-orange and a "Suggested" badge appears next to the
 *     specialty.
 *   - The card scrolls itself into the viewport center via a
 *     useEffect on `isSuggested`, deferred via requestAnimationFrame
 *     so the badge has rendered before we scroll (ensures the badge
 *     is visible when the card is centered, especially on mobile).
 *   - The model's `reason` renders inline below the bio in
 *     payphone-orange/15 so the user understands WHY this expert was
 *     picked. Always-visible text — no tooltip — works on touch
 *     devices and is more legible than hover state.
 *
 * Layout (unchanged from M4):
 *   ┌─ avatar ─┬─ name + specialty (icon)
 *   │          │  bio (1-2 lines)
 *   │          ├─ rate badge
 *   │          └─ "Talk to <name>" button
 */

import { Code2, Cpu, Sparkles, Cog, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { startSession } from '@/app/_actions/session';
import { ExpertCardSubmitButton } from '@/components/ExpertCardSubmitButton';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { avatarUrl } from '@/lib/avatar';
import type { DemoExpert } from '@/lib/seed';

/**
 * Map seed.iconName → Lucide component. Listed here (not in seed.ts)
 * because seed.ts is data-only and importing JSX components there would
 * widen its type surface for no benefit.
 */
const ICON_MAP: Record<DemoExpert['iconName'], LucideIcon> = {
  Code2,
  Cpu,
  Sparkles,
  Cog,
};

type Props = {
  expert: DemoExpert;
  /** True when the AI suggester picked this expert. */
  isSuggested?: boolean;
  /** Model's one-line reason for the pick. Rendered below the bio. */
  suggestedReason?: string | null;
};

export function ExpertCard({
  expert,
  isSuggested = false,
  suggestedReason = null,
}: Props): React.ReactElement {
  const Icon = ICON_MAP[expert.iconName];
  // DiceBear `personas` SVGs render with a colored background plate —
  // we tint it to match the surface-elevated token so the avatar
  // doesn't look pasted-on against the dark card.
  const avatarSrc = avatarUrl(expert.avatarSeed, { backgroundColor: '1f1f22' });
  const firstName = expert.name.split(' ')[0] ?? expert.name;

  // Scroll the card into view when the AI suggester picks it. Deferred
  // via rAF so the badge has rendered before scroll fires — without
  // this, mobile sometimes scrolls a frame ahead of the badge mounting
  // and the user lands on a centered card that "becomes" suggested
  // half a second later, which feels janky.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isSuggested) return;
    const node = cardRef.current;
    if (!node) return;
    const id = requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [isSuggested]);

  return (
    <Card
      ref={cardRef}
      className={
        'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ' +
        (isSuggested
          ? 'border-payphone-orange/60 bg-payphone-surface shadow-lg shadow-payphone-orange/10 hover:border-payphone-orange/70 hover:shadow-payphone-orange/20'
          : 'border-payphone-border bg-payphone-surface hover:border-payphone-blue/40 hover:shadow-payphone-blue/10')
      }
    >
      <CardHeader className="flex flex-row items-start gap-4 space-y-0">
        {/* Inline <img>: SVG from DiceBear's CDN — Next/Image overhead isn't worth it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarSrc}
          alt=""
          width={64}
          height={64}
          className="h-16 w-16 shrink-0 rounded-full ring-1 ring-payphone-border"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-payphone-ink">{expert.name}</h3>
            {isSuggested ? (
              <Badge
                variant="secondary"
                className="shrink-0 border-payphone-orange/30 bg-payphone-orange/15 text-payphone-orange hover:bg-payphone-orange/20"
                title={suggestedReason ?? undefined}
              >
                <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
                Suggested
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 text-sm text-payphone-ink-muted">
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{expert.specialty}</span>
          </div>
        </div>
        <Badge
          variant="secondary"
          className="shrink-0 border-payphone-orange/20 bg-payphone-orange/10 text-payphone-orange hover:bg-payphone-orange/15"
        >
          {expert.displayRate}
        </Badge>
      </CardHeader>

      <CardContent className="flex-1">
        <p className="text-sm leading-relaxed text-payphone-ink-muted">{expert.bio}</p>
        {isSuggested && suggestedReason ? (
          <p className="mt-3 rounded-md border border-payphone-orange/20 bg-payphone-orange/10 px-3 py-2 text-xs leading-relaxed text-payphone-orange">
            <span className="font-semibold">Why suggested:</span> {suggestedReason}
          </p>
        ) : null}
      </CardContent>

      <CardFooter>
        {/* Form-action server action: x402 round-trip happens server-side, then
            redirects to /session/[id]. The submit button is a client component
            that reads `useFormStatus()` for the in-flight pending state. */}
        <form action={startSession} className="w-full">
          <input type="hidden" name="expertId" value={expert.id} />
          <ExpertCardSubmitButton firstName={firstName} />
        </form>
      </CardFooter>
    </Card>
  );
}
