'use client';

/**
 * PayPhone — AI expert suggester (M5.5).
 *
 * Free-form chat input that sits above the expert grid on /marketplace.
 * The user describes what they need help with ("I need help with gas
 * optimization"); we POST it to /api/experts/suggest, Haiku picks the
 * best-matched seeded expert, and we hand the `(expertId, reason)`
 * back to the parent client wrapper which then highlights + scrolls
 * to the matching card.
 *
 * UX notes:
 *   - Sparkles icon as the affordance — same iconography we use for
 *     the AI summary header on the recap page.
 *   - Submit button shows Loader2 spinner while pending; both input
 *     and button disable so a double-click can't fire two requests.
 *   - On API failure (502 / network), surface a quiet orange-tinted
 *     banner below the input — "couldn't suggest right now, pick from
 *     the list below" — and keep the user's text intact so they can
 *     retry without retyping.
 *   - Empty/whitespace-only submit is guarded client-side so the
 *     server doesn't see noise.
 *
 * The actual highlighting/scroll lives in the parent
 * `<MarketplaceClient />`; this component only fires the callback.
 */

import { Loader2, Sparkles } from 'lucide-react';
import { useState, useTransition } from 'react';

type Props = {
  onSuggested: (expertId: string, reason: string) => void;
};

/** Generic, friendly fallback when the suggester can't deliver. */
const ERROR_MESSAGE = "Couldn't suggest right now — pick from the list below.";

type SuggestResponse = { expertId: string; reason: string } | { error: string };

export function ExpertSuggester({ onSuggested }: Props) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/experts/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed }),
        });
        if (!res.ok) {
          setError(ERROR_MESSAGE);
          return;
        }
        const data = (await res.json()) as SuggestResponse;
        if ('error' in data) {
          setError(ERROR_MESSAGE);
          return;
        }
        onSuggested(data.expertId, data.reason);
      } catch {
        setError(ERROR_MESSAGE);
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-payphone-border bg-payphone-surface/70 p-4 backdrop-blur-md md:p-5"
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-payphone-ink-muted">
        <Sparkles className="h-3.5 w-3.5 text-payphone-blue" aria-hidden="true" />
        <span>Not sure who to talk to?</span>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={pending}
          maxLength={500}
          placeholder="Tell us what you need help with…"
          aria-label="Describe what you need help with"
          className="min-w-0 flex-1 rounded-lg border border-payphone-border bg-payphone-bg/60 px-4 py-2.5 text-sm text-payphone-ink placeholder:text-payphone-ink-muted/70 focus:border-payphone-blue/60 focus:outline-none focus:ring-1 focus:ring-payphone-blue/40 disabled:cursor-not-allowed disabled:opacity-60 md:text-base"
        />
        <button
          type="submit"
          disabled={pending || query.trim().length === 0}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-payphone-blue px-5 py-2.5 text-sm font-semibold text-payphone-ink shadow-md shadow-payphone-blue/20 transition-all hover:bg-payphone-blue/90 hover:shadow-lg hover:shadow-payphone-blue/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-md md:text-base"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Thinking…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Suggest an expert
            </>
          )}
        </button>
      </div>
      {error ? (
        <p className="rounded-md border border-payphone-orange/20 bg-payphone-orange/10 px-3 py-2 text-xs text-payphone-orange">
          {error}
        </p>
      ) : null}
    </form>
  );
}
