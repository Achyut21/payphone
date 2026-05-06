/**
 * PayPhone — expert marketplace card.
 *
 * Pure server component (no 'use client'). Avatar is an `<img>` to
 * DiceBear's hosted API; rationale + trade-offs in `lib/avatar.ts`. The
 * "Talk to" button submits a form whose action is the server action
 * `startSession`, which runs the x402 round-trip server-side and
 * redirects to `/session/[id]`.
 *
 * Layout:
 *   ┌─ avatar ─┬─ name + specialty (icon)
 *   │          │  bio (1-2 lines)
 *   │          ├─ rate badge
 *   │          └─ "Talk to <name>" button
 */

import { Code2, Cpu, Sparkles, Cog, type LucideIcon } from 'lucide-react';

import { startSession } from '@/app/_actions/session';
import { Button } from '@/components/ui/button';
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
  const avatarSrc = avatarUrl(expert.avatarSeed, { backgroundColor: 'f4f4f5' });
  const firstName = expert.name.split(' ')[0] ?? expert.name;

  return (
    <Card className="border-payphone-border bg-payphone-surface transition-shadow hover:shadow-md">
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
          <div className="flex items-center gap-1.5 text-sm text-payphone-muted">
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{expert.specialty}</span>
          </div>
        </div>
        <Badge
          variant="secondary"
          className="shrink-0 bg-payphone-blue/10 text-payphone-blue hover:bg-payphone-blue/15"
        >
          {expert.displayRate}
        </Badge>
      </CardHeader>

      <CardContent>
        <p className="text-sm leading-relaxed text-payphone-muted">{expert.bio}</p>
      </CardContent>

      <CardFooter>
        {/* Form-action server action: x402 round-trip happens server-side, then
            redirects to /session/[id]. Browser shows a brief navigation pause
            (~5-10s) while the buyer signs and the room is created. */}
        <form action={startSession} className="w-full">
          <input type="hidden" name="expertId" value={expert.id} />
          <Button
            type="submit"
            size="lg"
            className="w-full bg-payphone-blue text-white hover:bg-payphone-blue/90"
          >
            Talk to {firstName}
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
