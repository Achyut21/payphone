/**
 * PayPhone — expert marketplace card.
 *
 * Pure server component (no 'use client'). The avatar is an `<img>` to
 * DiceBear's hosted API; rationale + trade-offs in `lib/avatar.ts`. The
 * action button is a Phase 2 placeholder — Phase 3 wires it to the
 * buyer-agent server action.
 *
 * Layout:
 *   ┌─ avatar ─┬─ name + specialty (icon)
 *   │          │  bio (1-2 lines)
 *   │          ├─ rate badge
 *   │          └─ "Talk to <name>" button
 */

import { Code2, Cpu, Sparkles, Cog, type LucideIcon } from 'lucide-react';

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
        {/* Phase 2 placeholder: button does nothing. Phase 3 wraps this in a
            <form action={startSessionAction}> and starts the x402 round-trip. */}
        <Button
          disabled
          size="lg"
          className="w-full bg-payphone-blue text-white hover:bg-payphone-blue/90"
        >
          Talk to {firstName}
        </Button>
      </CardFooter>
    </Card>
  );
}
