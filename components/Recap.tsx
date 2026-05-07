/**
 * PayPhone — recap UI (client component, M4.5 redesign).
 *
 * Three stacked sections:
 *   1. Settle status — "Settled" badge with pulsing payphone-success dot,
 *      big monospace amount + duration, BaseScan link. Visual mirror of
 *      the live last-call widget on the marketing landing.
 *   2. AI summary — streamed live from /api/sessions/[id]/recap
 *   3. Follow-up chat — streamed via /api/sessions/[id]/chat (AI SDK
 *      `useChat` hook handles message state)
 *
 * Backend wiring is preserved verbatim from M4 — the streaming fetch +
 * AbortController, the markdown-it summary parsing, the useChat /
 * DefaultChatTransport hookup, the message auto-scroll. All visual.
 *
 * Why not `useCompletion` for the summary: `useCompletion` POSTs and
 * sends a `prompt` field; our recap endpoint is a GET that derives
 * everything from the session id. Hand-rolled `fetch` + reader is
 * simpler than fighting the hook's API shape.
 */

'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import MarkdownIt from 'markdown-it';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Markdown renderer instance. `markdown-it` ships CJS-compatible builds
 * (unlike marked v18+ and react-markdown, both pure ESM as of 2025).
 * Configured for safe-ish output: html=false strips inline HTML in
 * the LLM's output (we trust Haiku, but defense-in-depth costs nothing),
 * and breaks=true converts single-newline to <br> for nicer rendering
 * during streaming when the model hasn't yet produced a paragraph.
 */
const md = new MarkdownIt({ html: false, breaks: true, linkify: true });

type RecapProps = {
  sessionId: string;
  expertName: string;
  expertSpecialty: string;
  /** Pre-formatted USD string like "$0.84". */
  settledUsd: string;
  /** Full BaseScan URL including the tx hash, or null if not settled. */
  settleTxUrl: string | null;
  /** Float; we floor to whole seconds for the m:ss label. */
  durationSec: number;
  settleFailed: boolean;
  /** True if the DDB row has any transcript lines; the summary will note
   *  the absence inline if false, but we surface it in the UI too. */
  hasTranscript: boolean;
};

/** "1:08" / "12:34" — leading-zero seconds, no leading-zero minutes. */
function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Recap({
  sessionId,
  expertName,
  expertSpecialty,
  settledUsd,
  settleTxUrl,
  durationSec,
  settleFailed,
  hasTranscript,
}: RecapProps) {
  // ------------------------- Summary stream -------------------------
  // Hand-rolled fetch + ReadableStream reader. The /api/sessions/[id]/recap
  // route streams plain text (Haiku's output token-by-token); we accumulate
  // into `summary` state and re-render markdown-it on each chunk.
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/recap`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (!cancelled) {
            setSummary((prev) => prev + chunk);
          }
        }
      } catch (err) {
        if (cancelled) return;
        // AbortError is expected when the user navigates away mid-stream.
        if (err instanceof Error && err.name === 'AbortError') return;
        setSummaryError(err instanceof Error ? err.message : 'failed');
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionId]);

  // Recompute parsed HTML whenever the streaming summary updates. Cheap
  // re-render — the summary is a few hundred words at most.
  const summaryHtml = useMemo(() => {
    if (!summary) return '';
    return md.render(summary);
  }, [summary]);

  // -------------------------- Chat ----------------------------------
  // useChat owns the message array; we just send via `sendMessage`.
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/sessions/${sessionId}/chat`,
    }),
  });
  const [input, setInput] = useState('');
  const chatBoxRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the chat scrollback as new messages stream in.
  useEffect(() => {
    chatBoxRef.current?.scrollTo({
      top: chatBoxRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  const chatBusy = status === 'streaming' || status === 'submitted';

  // -------------------------- Render --------------------------------
  return (
    <>
      {/* Back link — small, low-visual-weight, top of stack. */}
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-payphone-ink-muted transition-colors hover:text-payphone-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to marketplace
      </Link>

      {/* ─── 1. Settle status header card ─── */}
      <SettleStatusCard
        sessionId={sessionId}
        expertName={expertName}
        expertSpecialty={expertSpecialty}
        settledUsd={settledUsd}
        durationSec={durationSec}
        settleTxUrl={settleTxUrl}
        settleFailed={settleFailed}
      />

      {/* ─── 2. AI summary card ─── */}
      <section className="flex flex-col gap-3 rounded-2xl border border-payphone-border bg-payphone-surface p-6 md:p-8">
        <header className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-payphone-orange" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted">
            AI summary
          </h2>
          {summaryLoading && summary.length > 0 && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-payphone-blue" aria-hidden="true" />
          )}
        </header>

        {summaryError ? (
          <p className="rounded-lg border border-payphone-orange/30 bg-payphone-orange/10 p-3 text-sm text-payphone-orange">
            Couldn&rsquo;t load the summary: {summaryError}
          </p>
        ) : summary.length === 0 && summaryLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-payphone-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin text-payphone-blue" aria-hidden="true" />
            {hasTranscript
              ? 'Generating your recap…'
              : 'No transcript was captured for this call. Generating a brief note…'}
          </div>
        ) : (
          // LLM output goes to our own DOM; we trust it. markdown-it is
          // configured with `html: false` so any raw HTML in the LLM's
          // output is escaped, not rendered. The `prose-invert` overrides
          // hand-tune Tailwind Typography for our dark palette.
          <div
            className="prose prose-sm prose-invert max-w-none text-payphone-ink prose-headings:text-payphone-ink prose-headings:font-semibold prose-strong:text-payphone-ink prose-em:text-payphone-ink-muted prose-code:rounded prose-code:bg-payphone-surface-elevated prose-code:px-1 prose-code:py-0.5 prose-code:text-payphone-orange prose-code:before:content-none prose-code:after:content-none prose-a:text-payphone-blue prose-a:no-underline hover:prose-a:underline prose-ul:text-payphone-ink prose-ol:text-payphone-ink prose-li:marker:text-payphone-ink-muted md:prose-base"
            dangerouslySetInnerHTML={{ __html: summaryHtml }}
          />
        )}
      </section>

      {/* ─── 3. Follow-up chat ─── */}
      <section className="flex flex-col gap-3 rounded-2xl border border-payphone-border bg-payphone-surface p-6 md:p-8">
        <header className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-payphone-blue" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted">
            Ask a follow-up
          </h2>
        </header>

        {messages.length > 0 && (
          <div
            ref={chatBoxRef}
            className="flex max-h-[420px] flex-col gap-3 overflow-y-auto rounded-xl border border-payphone-border bg-payphone-bg/40 p-4 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-payphone-border [&::-webkit-scrollbar]:w-1.5"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === 'user'
                    ? 'max-w-[85%] self-end rounded-2xl bg-payphone-blue px-4 py-2 text-sm text-payphone-ink shadow-md shadow-payphone-blue/20'
                    : 'max-w-[85%] self-start rounded-2xl bg-payphone-surface-elevated px-4 py-2 text-sm text-payphone-ink ring-1 ring-payphone-border'
                }
              >
                {m.parts.map((part, i) =>
                  part.type === 'text' ? <span key={i}>{part.text}</span> : null,
                )}
              </div>
            ))}
            {chatBusy && (
              <div className="self-start rounded-2xl bg-payphone-surface-elevated px-4 py-2 text-sm text-payphone-ink-muted ring-1 ring-payphone-border">
                <Loader2
                  className="inline h-3.5 w-3.5 animate-spin text-payphone-blue"
                  aria-hidden="true"
                />
              </div>
            )}
          </div>
        )}

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = input.trim();
            if (!text || chatBusy) return;
            void sendMessage({ text });
            setInput('');
          }}
        >
          <input
            type="text"
            placeholder={
              hasTranscript
                ? 'e.g. What did we agree to do next?'
                : 'No transcript available; ask anyway and the model will tell you'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={chatBusy}
            className="flex-1 rounded-xl border border-payphone-border bg-payphone-bg/60 px-4 py-2.5 text-sm text-payphone-ink placeholder:text-payphone-ink-muted/60 focus:border-payphone-blue/50 focus:outline-none focus:ring-2 focus:ring-payphone-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={chatBusy || input.trim().length === 0}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-payphone-blue text-payphone-ink shadow-md shadow-payphone-blue/20 transition-all hover:bg-payphone-blue/90 hover:shadow-lg hover:shadow-payphone-blue/30 disabled:cursor-not-allowed disabled:bg-payphone-blue/40 disabled:shadow-none"
            aria-label="Send"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </section>
    </>
  );
}

/* ────────── Subcomponents ────────── */

/**
 * Settle status header. Big mono amount + duration, "Settled" badge with
 * pulsing payphone-success dot (or payphone-orange Settle Failed for
 * errors), expert info, BaseScan link with the orange ExternalLink icon
 * matching /docs and the landing's last-call widget.
 */
function SettleStatusCard({
  sessionId,
  expertName,
  expertSpecialty,
  settledUsd,
  durationSec,
  settleTxUrl,
  settleFailed,
}: {
  sessionId: string;
  expertName: string;
  expertSpecialty: string;
  settledUsd: string;
  durationSec: number;
  settleTxUrl: string | null;
  settleFailed: boolean;
}) {
  // M4.9 retry-settle UX. Hits POST /api/sessions/[id]/retry-settle
  // and reloads on success so the page re-renders as COMPLETED. Stays
  // on the failed view + surfaces the error on retry-also-failed.
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/retry-settle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setRetryError(body.detail || body.error || `HTTP ${res.status}`);
        return;
      }
      // Success — server flipped status to COMPLETED. Reload so the
      // page re-renders the success state with the new tx hash.
      window.location.reload();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'network error');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-payphone-border bg-payphone-surface p-6 md:p-8">
      {/* Status badge — green (settled) or orange (failed). */}
      <div className="flex items-center gap-2">
        {settleFailed ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-payphone-orange/40 bg-payphone-orange/10 px-3 py-1 text-xs font-semibold text-payphone-orange">
            <TriangleAlert className="h-3 w-3" aria-hidden="true" />
            <span className="uppercase tracking-wider">Settle failed</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-payphone-success/30 bg-payphone-success/10 px-3 py-1 text-xs font-semibold text-payphone-success">
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-payphone-success"
              aria-hidden="true"
            />
            <span className="uppercase tracking-wider">Settled on-chain</span>
          </span>
        )}
      </div>

      {/* Big amount + duration. Tabular nums so the digits don't visually
          jiggle if the same recap is loaded twice (e.g., a refresh). */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span
          className={`font-mono text-5xl font-semibold tabular-nums tracking-tight md:text-6xl ${
            settleFailed ? 'text-payphone-orange' : 'text-payphone-success'
          }`}
        >
          {settledUsd}
        </span>
        <span className="font-mono text-2xl text-payphone-ink-muted md:text-3xl">
          · {formatDuration(durationSec)}
        </span>
      </div>

      {/* Expert info + checkmark badge in one row. */}
      <div className="flex items-center gap-2 text-sm text-payphone-ink-muted md:text-base">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-payphone-success" aria-hidden="true" />
        <span>
          Call complete with <span className="font-medium text-payphone-ink">{expertName}</span> ·{' '}
          {expertSpecialty}
        </span>
      </div>

      {/* M4.9: settle-failed retry block. Shown only when settleFailed.
          Explains what happened, offers manual retry, surfaces the
          error if retry ALSO fails. */}
      {settleFailed && (
        <div className="flex flex-col gap-3 rounded-lg border border-payphone-orange/40 bg-payphone-orange/5 p-4">
          <p className="text-sm leading-relaxed text-payphone-ink-muted">
            The on-chain settlement attempt didn&apos;t go through. Your authorization is still
            valid — try again, or contact support if it keeps failing.
          </p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex w-fit items-center gap-2 rounded-lg bg-payphone-orange px-4 py-2 text-sm font-semibold text-payphone-ink shadow-md shadow-payphone-orange/20 transition-all hover:bg-payphone-orange/90 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
          >
            {retrying ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Retrying…
              </>
            ) : (
              <>
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                Retry settlement
              </>
            )}
          </button>
          {retryError && (
            <p className="text-xs leading-relaxed text-payphone-orange">
              Retry failed: {retryError}
            </p>
          )}
        </div>
      )}

      {/* BaseScan link. Sits in its own row so it's always tappable on
          mobile (avoiding the "tap target swallowed by neighbor" issue). */}
      {settleTxUrl && (
        <a
          href={settleTxUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-start rounded-full bg-payphone-orange/10 px-4 py-2 text-sm font-medium text-payphone-orange transition-colors hover:bg-payphone-orange/15"
        >
          View on BaseScan
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
    </section>
  );
}
