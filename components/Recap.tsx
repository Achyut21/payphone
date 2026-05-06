/**
 * PayPhone — recap UI (client component).
 *
 * Three stacked sections:
 *   1. Settle status — badge with USD amount, duration, BaseScan link
 *   2. AI summary — streamed live from /api/sessions/[id]/recap
 *   3. Follow-up chat — streamed via /api/sessions/[id]/chat (AI SDK
 *      `useChat` hook handles message state)
 *
 * Why not `useCompletion` for the summary: `useCompletion` POSTs and
 * sends a `prompt` field; our recap endpoint is a GET that derives
 * everything from the session id. Hand-rolled `fetch` + reader is
 * simpler than fighting the hook's API shape.
 */

'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ExternalLink, Loader2, Send } from 'lucide-react';
import Link from 'next/link';
import MarkdownIt from 'markdown-it';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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
  settledUsd,
  settleTxUrl,
  durationSec,
  settleFailed,
  hasTranscript,
}: RecapProps) {
  // ------------------------- Summary stream -------------------------
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
      {/* Header: settle status. */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium uppercase tracking-wide text-payphone-blue">
            Call complete
          </p>
          <Link
            href="/"
            className="text-sm font-medium text-payphone-muted hover:text-payphone-ink"
          >
            ← Back to marketplace
          </Link>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-payphone-ink">
          Recap of your call with {expertName}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {settleFailed ? (
            <span className="rounded-full bg-red-50 px-3 py-1 font-medium text-red-700">
              Settle failed
            </span>
          ) : (
            <span className="rounded-full bg-payphone-blue/10 px-3 py-1 font-mono font-semibold text-payphone-blue">
              Settled {settledUsd}
            </span>
          )}
          <span className="font-mono text-payphone-muted">{formatDuration(durationSec)}</span>
          {settleTxUrl && (
            <Link
              href={settleTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-payphone-muted underline-offset-4 hover:text-payphone-ink hover:underline"
            >
              View on BaseScan
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </header>

      {/* Summary — markdown streamed in. */}
      <Card className="border-payphone-border bg-payphone-surface">
        <CardContent className="prose prose-sm max-w-none px-6 py-5 text-payphone-ink prose-headings:text-payphone-ink prose-p:text-payphone-ink prose-strong:text-payphone-ink prose-li:text-payphone-ink">
          {summaryError ? (
            <p className="text-red-600">Couldn’t load the summary: {summaryError}</p>
          ) : summary.length === 0 && summaryLoading ? (
            <div className="flex items-center gap-2 text-sm text-payphone-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {hasTranscript
                ? 'Generating your recap…'
                : 'No transcript was captured for this call. Generating a brief note…'}
            </div>
          ) : (
            // LLM output goes to our own DOM; we trust it. markdown-it is
            // configured with `html: false` so any raw HTML in the LLM's
            // output is escaped, not rendered.
            <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
          )}
        </CardContent>
      </Card>

      {/* Chat — follow-up Qs grounded in the transcript. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-payphone-ink">
          Ask a follow-up about this call
        </h2>

        {messages.length > 0 && (
          <div
            ref={chatBoxRef}
            className="flex max-h-[420px] flex-col gap-3 overflow-y-auto rounded-lg border border-payphone-border bg-payphone-surface p-4"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === 'user'
                    ? 'self-end rounded-2xl bg-payphone-blue px-4 py-2 text-sm text-white shadow-sm'
                    : 'self-start rounded-2xl bg-payphone-bg px-4 py-2 text-sm text-payphone-ink ring-1 ring-payphone-border'
                }
              >
                {m.parts.map((part, i) =>
                  part.type === 'text' ? <span key={i}>{part.text}</span> : null,
                )}
              </div>
            ))}
            {chatBusy && (
              <div className="self-start rounded-2xl bg-payphone-bg px-4 py-2 text-sm text-payphone-muted ring-1 ring-payphone-border">
                <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
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
          <Input
            placeholder={
              hasTranscript
                ? 'e.g. What did we agree to do next?'
                : 'No transcript available; ask anyway and the model will tell you'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1"
            disabled={chatBusy}
          />
          <Button
            type="submit"
            disabled={chatBusy || input.trim().length === 0}
            className="bg-payphone-blue text-white hover:bg-payphone-blue/90"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </section>
    </>
  );
}
