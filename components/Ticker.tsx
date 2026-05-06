/**
 * PayPhone — live billing ticker.
 *
 * Counts up from a fixed `startedAt` (unix seconds) at 250ms cadence so
 * the digit roll feels smooth, but DISPLAYS to the second so the dollar
 * value matches what the on-chain settle will be (see `computeSettleAmount`
 * in `lib/constants.ts` — `Math.floor(durationSec)` is the source of
 * truth). Keeping these aligned is intentional: what the user sees is
 * what they pay.
 *
 * Color: payphone-blue. Mono font so the digits don't visually jiggle as
 * each second passes. Cap shown subtly underneath since the user
 * authorized "up to" a max.
 */

'use client';

import { useEffect, useState } from 'react';

type TickerProps = {
  /** Unix seconds (NOT milliseconds) when the session started — usually `started_at` from DDB. */
  startedAt: number;
  /**
   * Unix seconds when the call ended. While null/undefined, the ticker
   * counts up live. Once set, the ticker freezes at exactly this elapsed
   * value — no more incrementing, no more re-renders. Set by SessionRoom
   * on the user's Leave click (optimistic) or Daily's `left-meeting`
   * event (backstop).
   */
  endedAt?: number | null;
  /** Atomic USDC charged per second. Default mirrors `M3_PER_SECOND_RATE_ATOMIC`. */
  perSecondAtomic?: bigint;
  /** Atomic USDC max — display only ("MAX $5.00"); we don't enforce client-side. */
  maxAuthorizedAtomic?: bigint;
};

/** USDC has 6 decimals on Base. Display in dollars-cents (2 fraction digits). */
const USDC_DECIMALS = 6n;
const ATOMIC_PER_DOLLAR = 10n ** USDC_DECIMALS;
/** $0.01 = 10_000 atomic. */
const DEFAULT_PER_SECOND_ATOMIC = 10_000n;
const DEFAULT_MAX_AUTHORIZED_ATOMIC = 5_000_000n;

function formatUsd(atomic: bigint): string {
  // Negative-safe (defensive): if the clock skews and elapsedSec briefly
  // computes negative, we want $0.00, not "$-0.01".
  const a = atomic < 0n ? 0n : atomic;
  const dollars = a / ATOMIC_PER_DOLLAR;
  // Truncate to cents (4 fewer decimals than full atomic precision).
  const centsBig = (a % ATOMIC_PER_DOLLAR) / 10_000n;
  const cents = centsBig.toString().padStart(2, '0');
  return `$${dollars.toString()}.${cents}`;
}

export function Ticker({
  startedAt,
  endedAt,
  perSecondAtomic = DEFAULT_PER_SECOND_ATOMIC,
  maxAuthorizedAtomic = DEFAULT_MAX_AUTHORIZED_ATOMIC,
}: TickerProps) {
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    // Once endedAt is set, the call is over — stop the interval entirely.
    // No need to keep re-rendering at 4Hz on a frozen value.
    if (endedAt !== null && endedAt !== undefined) return;
    const interval = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 250);
    return () => clearInterval(interval);
  }, [endedAt]);

  // If the call has ended, snap elapsed to the frozen endedAt; otherwise
  // track live with `now`. This means the displayed total at the moment
  // of leave is the value the on-chain settle will use.
  const reference = endedAt ?? now;
  const elapsedSec = Math.max(0, reference - startedAt);
  // Cap the displayed amount at MAX so we never show a value the chain
  // would refuse. Doesn't affect on-chain settle (the proxy enforces
  // it), but keeps the UI honest.
  const rawAtomic = BigInt(elapsedSec) * perSecondAtomic;
  const cappedAtomic = rawAtomic > maxAuthorizedAtomic ? maxAuthorizedAtomic : rawAtomic;

  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  const elapsedLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="font-mono text-4xl font-semibold tabular-nums text-payphone-blue">
        {formatUsd(cappedAtomic)}
      </div>
      <div className="font-mono text-xs text-payphone-muted">
        {elapsedLabel} · max {formatUsd(maxAuthorizedAtomic)}
      </div>
    </div>
  );
}
