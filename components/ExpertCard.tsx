/**
 * PayPhone — expert marketplace card (M4.5 redesign).
 *
 * Pure server component. The avatar is an `<img>` to DiceBear's hosted
 * API (rationale + trade-offs in `lib/avatar.ts`); the "Talk to" button
 * lives in `<ExpertCardSubmitButton />` (client) so it can read the
 * parent form's pending state via `useFormStatus()`.
 *
 * The form's action is the `startSession` server action, which runs the
 * x402 round-trip server-side and redirects to `/session/[id]`. While
 * that's in flight the button switches to a spinner + "Connecting..."
 * label and disables (so a double-click can't fire two actions and burn
 * two Permit2 nonces).
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
 * Layout (unchanged from M4):
 *   ┌─ avatar ─┬─ name + specialty (icon)
 *   │          │  bio (1-2 lines)
 *   │          ├─ rate badge
 *   │          └─ "Talk to <name>" button
 */

import { Code2, Cpu, Sparkles, Cog, type LucideIcon } from 'lucide-react';

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

export function ExpertCard({ expert }: { expert: DemoExpert }): React.ReactElement {
  const Icon = ICON_MAP[expert.iconName];
  // DiceBear `personas` SVGs render with a colored background plate —
  // we tint it to match the surface-elevated token so the avatar
  // doesn't look pasted-on against the dark card.
  const avatarSrc = avatarUrl(expert.avatarSeed, { backgroundColor: '1f1f22' });
  const firstName = expert.name.split(' ')[0] ?? expert.name;

  return (
    <Card className="border-payphone-border bg-payphone-surface transition-all duration-200 hover:-translate-y-0.5 hover:border-payphone-blue/40 hover:shadow-lg hover:shadow-payphone-blue/10">
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
          <h3 className="truncate text-lg font-semibold text-payphone-ink">{expert.name}</h3>
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
