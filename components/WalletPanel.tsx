'use client';

/**
 * PayPhone — wallet panel for the marketplace (M5 Phase 5).
 *
 * Sits above the expert grid. Shows:
 *   - The user's CDP wallet address (truncated, BaseScan link, copy on click)
 *   - Live USDC balance (polled every 8s)
 *   - "Fund my wallet" button when balance is below the threshold
 *     ($5 — the upto verify simulation amount, so anything less means
 *     the next "Talk to ..." click would fail at simulation)
 *
 * Faucet button is hidden entirely on mainnet (`ACTIVE_NETWORK === 'mainnet'`)
 * since the CDP testnet faucet doesn't apply there. M6 dress rehearsal
 * relies on the M0-funded shared wallet for the demo account.
 *
 * Polling: simple 8-second interval. Cleared on unmount. We don't bother
 * with optimistic updates — the faucet response includes the new balance
 * implicitly (next poll picks it up, ~few seconds after Sepolia confirms).
 */

import { useCallback, useEffect, useState, useTransition } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Wallet } from 'lucide-react';

import { ACTIVE_NETWORK } from '@/lib/constants';

const POLL_INTERVAL_MS = 8_000;
/** Minimum USD balance to enable session creation without a fund prompt. */
const FUND_THRESHOLD_USD = 5;

const BASESCAN_ADDRESS_PREFIX =
  ACTIVE_NETWORK === 'mainnet'
    ? 'https://basescan.org/address/'
    : 'https://sepolia.basescan.org/address/';

type BalanceResponse = {
  address: `0x${string}`;
  network: 'mainnet' | 'sepolia';
  balanceAtomic: string;
  balanceUsd: string;
};

type FaucetResponse =
  | { ok: true; address: string; txHash?: string; message: string }
  | { ok: false; message: string; fallback_url?: string };

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletPanel() {
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [faucetMessage, setFaucetMessage] = useState<{
    text: string;
    fallbackUrl?: string;
    ok: boolean;
  } | null>(null);
  const [isFunding, startFunding] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/users/me/balance', { cache: 'no-store' });
      if (!response.ok) {
        setError(`balance fetch failed (${response.status})`);
        return;
      }
      const data = (await response.json()) as BalanceResponse;
      setBalance(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'balance fetch failed');
    }
  }, []);

  useEffect(() => {
    // Wrap in a sync function so React 19's `set-state-in-effect` lint
    // rule sees a function call rather than a top-level Promise/setState.
    const tick = () => {
      void refresh();
    };
    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleFund = useCallback(() => {
    setFaucetMessage(null);
    startFunding(async () => {
      try {
        const response = await fetch('/api/users/me/faucet', { method: 'POST' });
        const data = (await response.json()) as FaucetResponse;
        setFaucetMessage({
          text: data.message,
          ok: data.ok,
          fallbackUrl: 'fallback_url' in data ? data.fallback_url : undefined,
        });
        // Refresh balance shortly after — Sepolia takes ~2s to confirm a faucet tx.
        setTimeout(() => void refresh(), 4_000);
      } catch (err) {
        setFaucetMessage({
          ok: false,
          text: err instanceof Error ? err.message : 'Faucet request failed.',
        });
      }
    });
  }, [refresh]);

  const balanceUsd = balance ? Number(balance.balanceUsd) : null;
  const showFaucetButton =
    ACTIVE_NETWORK === 'sepolia' && balanceUsd !== null && balanceUsd < FUND_THRESHOLD_USD;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-payphone-border bg-payphone-surface/70 p-4 backdrop-blur-md md:flex-row md:items-center md:justify-between md:gap-6 md:p-5">
      {/* Address + balance */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-payphone-blue/10 text-payphone-blue">
          <Wallet className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-xs uppercase tracking-wide text-payphone-ink-muted">Your wallet</p>
          {balance ? (
            <a
              href={`${BASESCAN_ADDRESS_PREFIX}${balance.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-payphone-ink hover:text-payphone-blue"
              title={balance.address}
            >
              <span className="font-mono">{truncateAddress(balance.address)}</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : (
            <p className="text-sm font-medium text-payphone-ink-muted">
              {error ? error : 'Resolving wallet…'}
            </p>
          )}
        </div>
      </div>

      {/* Balance + action */}
      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-4">
        <div className="flex flex-col items-start gap-0.5 md:items-end">
          <p className="text-xs uppercase tracking-wide text-payphone-ink-muted">Balance</p>
          <p className="font-mono text-lg font-semibold text-payphone-ink">
            {balance ? `$${Number(balance.balanceUsd).toFixed(2)}` : '—'}{' '}
            <span className="text-xs font-normal text-payphone-ink-muted">USDC</span>
          </p>
        </div>
        {showFaucetButton ? (
          <button
            type="button"
            onClick={handleFund}
            disabled={isFunding}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-payphone-orange px-4 py-2 text-sm font-semibold text-payphone-ink shadow-md shadow-payphone-orange/20 transition-all hover:bg-payphone-orange/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isFunding ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Funding…
              </>
            ) : (
              'Fund my wallet'
            )}
          </button>
        ) : null}
      </div>

      {/* Faucet response banner — full-width below the panel header */}
      {faucetMessage ? (
        <div
          className={`-mt-1 w-full rounded-xl border p-3 text-sm md:basis-full ${
            faucetMessage.ok
              ? 'border-payphone-success/40 bg-payphone-success/10 text-payphone-success'
              : 'border-payphone-orange/40 bg-payphone-orange/10 text-payphone-orange'
          }`}
        >
          <div className="flex items-start gap-2">
            {faucetMessage.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : null}
            <div className="flex flex-col gap-1">
              <p>{faucetMessage.text}</p>
              {faucetMessage.fallbackUrl ? (
                <a
                  href={faucetMessage.fallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                >
                  {faucetMessage.fallbackUrl}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
