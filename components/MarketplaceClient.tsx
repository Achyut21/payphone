'use client';

/**
 * PayPhone — marketplace client wrapper (M5.5).
 *
 * The marketplace page (`app/marketplace/page.tsx`) is a server
 * component, but the AI expert suggester is a stateful client widget
 * that drives "highlight and scroll to" on a chosen card. To bridge
 * that boundary, this component:
 *
 *   1. Receives the seeded expert list as a plain-data prop.
 *   2. Renders `<ExpertSuggester />` above the grid.
 *   3. Holds `{ suggestedExpertId, suggestedReason }` state, set when
 *      the suggester's callback fires.
 *   4. Renders the grid of `<ExpertCard />` components, passing each
 *      whether it's the suggested one (so the card shows the badge +
 *      requests scrollIntoView itself).
 *
 * `<ExpertCard />` was converted to a Client Component in M5.5 so it
 * can read the `suggested*` props and run the `useEffect` for
 * scrollIntoView. Server actions (e.g. `startSession`) still work
 * fine inside it — Next.js bundles them as RPC calls when invoked
 * from a Client Component, no special handling needed.
 *
 * No persistence: the suggestion state lives only for the lifetime of
 * the page render. A page refresh resets to "no suggestion".
 */

import { useState } from 'react';

import { ExpertCard } from '@/components/ExpertCard';
import { ExpertSuggester } from '@/components/ExpertSuggester';
import type { DemoExpert } from '@/lib/seed';

type Suggestion = { expertId: string; reason: string } | null;

type Props = {
  experts: readonly DemoExpert[];
};

export function MarketplaceClient({ experts }: Props) {
  const [suggestion, setSuggestion] = useState<Suggestion>(null);

  return (
    <div className="flex flex-col gap-6">
      <ExpertSuggester onSuggested={(expertId, reason) => setSuggestion({ expertId, reason })} />

      {/* 1 / 2 / 3 grid: at lg+ the four experts render as a 3-up
          row plus one solo below — feels intentional rather than
          half-empty. (Layout preserved verbatim from M4.5.) */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
        {experts.map((expert) => {
          const isSuggested = suggestion?.expertId === expert.id;
          return (
            <ExpertCard
              key={expert.id}
              expert={expert}
              isSuggested={isSuggested}
              suggestedReason={isSuggested ? (suggestion?.reason ?? null) : null}
            />
          );
        })}
      </section>
    </div>
  );
}
