/**
 * PayPhone — live session room (M4.5 redesign).
 *
 * Backend wiring is UNCHANGED from M4: Daily iframe lifecycle, Strict-
 * Mode-safe singleton handling, transcription event capture + POST to
 * `/api/sessions/[id]/transcript`, 2-second status polling, ticker
 * freeze on Leave. Visual layout was overhauled.
 *
 * M4.5 layout:
 *   - Mobile (<lg): vertical stack. Sticky `$X.XX` mini-bar across the
 *     top, full-width iframe, collapsible transcript panel, and a big
 *     payphone-orange "End call & settle" button anchored at the
 *     bottom. The mini-bar floats with backdrop-blur so it stays
 *     legible over the iframe when scrolled.
 *   - Desktop (lg+): horizontal split. iframe takes ~70% left, a
 *     sticky right sidebar (~30%) carries the big ticker, the live
 *     transcript scroll, and the end-call CTA.
 *   - "ON AIR" badge (pulsing payphone-orange dot + label) sits in
 *     the top-right corner of the iframe container so the demo audience
 *     instantly clocks "this is live, not a screenshot."
 *
 * One additive change vs. M4: transcript lines are held in client state
 * (`liveTranscript`) so they can render in the new panel as they
 * arrive. The POST behavior is preserved exactly — local-participant
 * lines still get POSTed to dedupe at the DDB level. Display includes
 * BOTH speakers (each browser tab sees its own captures + the remote's
 * captures via Daily's broadcast) so the buyer's UI feels real.
 *
 * Cleanup is critical:
 *   - Destroy the Daily call object on unmount or it leaks an iframe
 *     instance per Strict Mode mount in dev.
 *   - Clear the polling interval too.
 */

'use client';

import DailyIframe, { type DailyCall } from '@daily-co/daily-js';
import { ChevronDown, ChevronUp, Loader2, MessageSquare, PhoneOff, Radio } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Ticker } from '@/components/Ticker';

type SessionRoomProps = {
  sessionId: string;
  roomUrl: string;
  /**
   * Daily meeting token, scoped to this room. Required for the host to
   * call `startTranscription()` — the URL-only join doesn't carry the
   * `canAdmin: 'transcription'` permission. May be null if the server
   * failed to mint one (transcription will silently skip).
   */
  roomToken: string | null;
  expertName: string;
  expertSpecialty: string;
  /** Unix seconds (NOT ms). The ticker counts from this. */
  startedAt: number;
};

/** Status route response shape (subset). Mirrors the GET handler. */
type StatusResponse = {
  status: 'AUTHORIZED' | 'ACTIVE' | 'COMPLETED' | 'SETTLE_FAILED';
};

/** Polling interval for the status endpoint, in ms. */
const STATUS_POLL_INTERVAL_MS = 2000;

/** A single rendered transcript line in the live panel. */
type TranscriptLine = {
  /** Stable key for React reconciliation; monotonic per session. */
  id: number;
  /** "hh:mm:ss" formatted UTC timestamp. */
  ts: string;
  /** Either "You" (local) or the expert's display name. */
  speaker: string;
  /** Visible content. */
  text: string;
  /** Whether this came from the local participant (drives styling). */
  isLocal: boolean;
};

export function SessionRoom({
  sessionId,
  roomUrl,
  roomToken,
  expertName,
  expertSpecialty,
  startedAt,
}: SessionRoomProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Unix seconds (NOT ms). Set when the call ends — either because the
  // user clicked our Leave button or Daily fired `left-meeting`. While
  // null, the ticker counts up; once set, the ticker freezes at this
  // value (so the displayed total matches what we'll settle for).
  const [endedAtSec, setEndedAtSec] = useState<number | null>(null);
  // Live transcript lines for the in-call panel (M4.5). M4 captured
  // these only to POST them to DDB; the visual surface is new.
  const [liveTranscript, setLiveTranscript] = useState<TranscriptLine[]>([]);
  // Mobile transcript collapsible — open by default on desktop, closed
  // on mobile so the iframe stays the focal point. Driven by a state
  // ref rather than CSS-only `<details>` so we can animate later.
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // Monotonic id source for transcript lines. Refs don't trigger
  // re-renders; we just need it to keep keys stable.
  const transcriptIdRef = useRef(0);

  // Mount the Daily iframe + join.
  //
  // React Strict Mode in dev double-mounts effects. Daily enforces a
  // global singleton on `DailyIframe` instances and `destroy()` is async,
  // so a naive `if (callRef.current) return` guard isn't enough — by the
  // time the second mount runs, our ref has been nulled by the cleanup
  // but Daily's internal singleton hasn't released yet, and createFrame
  // throws "Duplicate DailyIframe instances are not allowed".
  //
  // Fix: do setup inside an async function. If `getCallInstance()` finds
  // a leftover from a previous mount, await its destroy before creating
  // the new one. Use a `cancelled` flag so the cleanup of an already-
  // unmounted effect doesn't attach event handlers to a stale instance.
  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      // Drain any pending destroy from a previous mount.
      const existing = DailyIframe.getCallInstance();
      if (existing) {
        try {
          await existing.destroy();
        } catch {
          /* best-effort; the singleton is module-level so we can't
             really recover beyond logging anyway */
        }
      }
      if (cancelled || !containerRef.current) return;

      const call = DailyIframe.createFrame(containerRef.current, {
        iframeStyle: {
          width: '100%',
          height: '100%',
          border: '0',
          borderRadius: '12px',
        },
        // Daily's built-in leave button shows a confirmation dialog and
        // requires two clicks to fully tear down. We use our own button
        // in the side panel instead — single source of truth, single
        // click. Hides the in-iframe button entirely.
        showLeaveButton: false,
        showFullscreenButton: true,
      });
      callRef.current = call;

      call.on('joined-meeting', () => {
        if (cancelled) return;
        setJoined(true);
        // Start realtime transcription. Requires the meeting token (passed
        // to call.join below) to grant `canAdmin: 'transcription'` —
        // without it, this no-ops silently. Daily's daily-js exposes
        // startTranscription as a fire-and-forget call (returns void);
        // runtime failures surface via the `transcription-error` event
        // we listen for below.
        try {
          call.startTranscription({
            // Deepgram's nova-2 is Daily's default; setting it explicitly
            // documents the choice and is forward-compatible with future
            // model rotations.
            model: 'nova-2-general',
            language: 'en',
          });
          console.log('[SessionRoom] startTranscription called');
        } catch (err) {
          console.warn('[SessionRoom] startTranscription threw:', err);
        }
      });

      // Diagnostic listeners — these fire when transcription either
      // succeeds (started) or fails (error). Without them, transcription
      // failures are silent and we'd never know if the recap will have
      // data. M5 polish: surface errors to the side panel.
      call.on('transcription-started', (event) => {
        console.log('[SessionRoom] transcription-started', event);
      });
      call.on('transcription-error', (event) => {
        console.warn('[SessionRoom] transcription-error', event);
      });
      call.on('transcription-stopped', (event) => {
        console.log('[SessionRoom] transcription-stopped', event);
      });

      /**
       * Realtime transcript capture. Daily's webhook surface does NOT include
       * per-utterance events — only `transcript.ready-to-download` after the
       * meeting finalizes. So we capture in the browser here and POST each
       * line to `/api/sessions/[id]/transcript`, which appends to the DDB
       * row's `transcript` list. Best-effort: a network blip just drops one
       * line, and the recap still works (just with a slightly shorter
       * transcript).
       *
       * M4.5 addition: in addition to POSTing local-participant lines, we
       * push EVERY line (local or remote) into `liveTranscript` state so
       * the in-call panel renders both speakers in real time. The
       * de-dup-via-local-only filter is preserved for the POST path so
       * DDB still gets each utterance exactly once.
       */
      call.on('transcription-message', (event) => {
        console.log('[SessionRoom] transcription-message', event);
        // Daily's typings around this event have shifted across SDK versions;
        // pull defensively via `unknown` to avoid coupling to a specific
        // SDK version. The shape we rely on is approximately:
        //   { text: string, participantId?: string, timestamp?: Date | string, is_final?: boolean }
        const e = event as unknown as {
          text?: string;
          participantId?: string;
          timestamp?: Date | string;
          is_final?: boolean;
          rawResponse?: { is_final?: boolean };
        };

        // Some Daily/Deepgram events are interim (partial) results. Only
        // persist final ones to avoid duplicates. If the flag is absent
        // (older SDK), accept the line — better to over-collect than miss.
        const isFinal = e.is_final ?? e.rawResponse?.is_final ?? true;
        if (!isFinal) {
          console.log('[SessionRoom] skipping non-final transcript chunk');
          return;
        }
        const text = e.text?.trim();
        if (!text) return;

        const ts = e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp ?? Date.now());
        const hh = String(ts.getUTCHours()).padStart(2, '0');
        const mm = String(ts.getUTCMinutes()).padStart(2, '0');
        const ss = String(ts.getUTCSeconds()).padStart(2, '0');
        const tsLabel = `${hh}:${mm}:${ss}`;

        // Local-or-remote check: Daily broadcasts events to every tab, so
        // each tab sees both speakers. We POST only local lines (DDB
        // dedup) but display both (live panel UX).
        const localSessionId = call.participants().local?.session_id;
        const isLocal = e.participantId !== undefined && e.participantId === localSessionId;

        // Always: feed the live panel. Cap at 200 lines to keep DOM small
        // on long calls — the recap pulls the full transcript from DDB.
        setLiveTranscript((prev) => {
          const next: TranscriptLine = {
            id: ++transcriptIdRef.current,
            ts: tsLabel,
            speaker: isLocal ? 'You' : expertName,
            text,
            isLocal,
          };
          const trimmed = prev.length >= 200 ? prev.slice(prev.length - 199) : prev;
          return [...trimmed, next];
        });

        // POST only local-participant utterances to /api/sessions/.../transcript
        // — same de-dup invariant as M4 (each utterance lands in DDB once,
        // because each browser tab only POSTs its own captures).
        if (!isLocal) return;

        const speaker = e.participantId ?? 'speaker';
        const line = `[${tsLabel}] ${speaker}: ${text}`;

        void fetch(`/api/sessions/${sessionId}/transcript`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ line }),
          // No keepalive: chunks flush in-flight; the iframe outlives this
          // until the user hits Leave anyway. If the page is closing
          // mid-utterance the line is lost — acceptable for the demo.
        }).catch((err: unknown) => {
          // Swallow — the next utterance will retry the chain.
          console.warn('[SessionRoom] transcript POST failed:', err);
        });
      });

      call.on('error', (event) => {
        if (cancelled) return;
        const msg = event && 'errorMsg' in event ? String(event.errorMsg) : 'Daily error';
        setError(msg);
      });

      // Freeze the ticker the instant Daily confirms the local participant
      // has left the room. This catches both paths: our Leave button (we
      // also set endedAt optimistically there for zero-lag UX) and any
      // edge case where Daily ends the call on its own (network drop,
      // room expiry, kicked, etc.). setState is a no-op when the value
      // is unchanged so the optimistic + confirmed paths don't fight.
      call.on('left-meeting', () => {
        if (cancelled) return;
        setEndedAtSec((prev) => prev ?? Math.floor(Date.now() / 1000));
      });

      try {
        // Token is what grants the `canAdmin: 'transcription'` permission
        // needed for `startTranscription()` to actually start. Without it,
        // we still join the room — just without transcription.
        await call.join(roomToken ? { url: roomUrl, token: roomToken } : { url: roomUrl });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(`join failed: ${msg}`);
      }
    };

    void setup();

    return () => {
      cancelled = true;
      const call = callRef.current;
      callRef.current = null;
      if (call) {
        void call.destroy().catch(() => {
          /* swallow — best-effort teardown */
        });
      }
    };
  }, [roomUrl, roomToken, sessionId, expertName]);

  // Poll session status; navigate to recap when COMPLETED.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/status`, { cache: 'no-store' });
        if (!res.ok) return; // 404/5xx → ignore this tick, try again next interval
        const body = (await res.json()) as StatusResponse;
        if (cancelled) return;
        if (body.status === 'COMPLETED') {
          router.push(`/session/${sessionId}/recap`);
        }
      } catch {
        // Network blip — silently retry on the next interval.
      }
    };
    const interval = setInterval(tick, STATUS_POLL_INTERVAL_MS);
    // Fire one immediately so we don't wait 2s if the user lands on a
    // session that's already settled (e.g. via a back-button).
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, router]);

  const handleLeave = () => {
    // Freeze the ticker NOW (don't wait for `left-meeting` to fire) so
    // the displayed total never advances past what we'll actually
    // settle on-chain. The `left-meeting` listener is a backstop that
    // no-ops if we already set this.
    setEndedAtSec(Math.floor(Date.now() / 1000));
    void callRef.current?.leave();
  };

  const settling = endedAtSec !== null;

  return (
    <div className="flex min-h-screen flex-col bg-payphone-bg lg:flex-row">
      {/* ─── MOBILE STICKY MINI-BAR (lg:hidden) ───
          The "you are spending money" anchor on phone. Floats over
          everything below it, backdrop-blur for legibility, full-width.
          Sticks to the page top inside the call route. */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-payphone-border bg-payphone-surface/80 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-payphone-ink-muted">
            On call · {expertName}
          </span>
          <Ticker startedAt={startedAt} endedAt={endedAtSec} />
        </div>
        <OnAirBadge settling={settling} compact />
      </div>

      {/* ─── VIDEO PANE ───
          Fills the remaining vertical space on mobile; on desktop, the
          70% left column. Relative-positioned wrapper hosts the ON AIR
          badge (top-right corner overlay). */}
      <section className="relative flex flex-1 flex-col p-4 lg:p-6">
        <div className="relative flex flex-1 overflow-hidden rounded-xl bg-payphone-surface-elevated shadow-lg shadow-black/30 lg:min-h-[60vh]">
          <div ref={containerRef} className="flex flex-1" />

          {/* Desktop ON AIR badge (top-right corner of video). The
              mobile version lives in the sticky bar above, so the
              corner badge would be redundant there — hide on <lg. */}
          <div className="absolute right-3 top-3 z-10 hidden lg:block">
            <OnAirBadge settling={settling} />
          </div>

          {/* Connection state overlays. */}
          {!joined && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-payphone-bg/40 text-sm text-payphone-ink-muted backdrop-blur-sm">
              <Loader2 className="h-5 w-5 animate-spin text-payphone-blue" />
              Connecting to the room…
            </div>
          )}
          {error && (
            <div className="absolute inset-x-4 top-4 z-20 rounded-lg border border-payphone-orange/40 bg-payphone-surface/90 p-3 text-sm text-payphone-orange backdrop-blur-sm">
              {error}
            </div>
          )}
        </div>

        {/* MOBILE-ONLY: collapsible transcript + bottom CTA.
            On desktop these live in the right sidebar. */}
        <div className="mt-4 flex flex-col gap-3 lg:hidden">
          <TranscriptCollapse
            lines={liveTranscript}
            open={transcriptOpen}
            onToggle={() => setTranscriptOpen((p) => !p)}
          />
          <EndCallButton settling={settling} onLeave={handleLeave} />
        </div>
      </section>

      {/* ─── DESKTOP STICKY RIGHT SIDEBAR (lg:flex, hidden below) ───
          Sticks to the top of the viewport so the ticker stays visible
          while the user scrolls (rare on a single-pane call but the
          stickiness costs nothing). Border on the LEFT separates it
          from the video pane. */}
      <aside className="hidden border-l border-payphone-border bg-payphone-surface/40 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-96 lg:flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-payphone-border p-6">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted">
              On call with
            </span>
            <h2 className="truncate text-lg font-semibold text-payphone-ink">{expertName}</h2>
            <p className="truncate text-sm text-payphone-ink-muted">{expertSpecialty}</p>
          </div>
        </header>

        <div className="flex flex-col gap-2 border-b border-payphone-border p-6">
          <span className="text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted">
            Running total
          </span>
          <div className="flex justify-end">
            <Ticker startedAt={startedAt} endedAt={endedAtSec} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-payphone-ink-muted">
            Settles on hangup for{' '}
            <code className="rounded bg-payphone-surface-elevated px-1 py-0.5 font-mono text-[10px] text-payphone-orange">
              floor(sec) × $0.01
            </code>
            . Unspent allowance never moves on-chain.
          </p>
        </div>

        {/* Transcript scroll — flex-1 so it fills the gap between
            ticker block and end-call button regardless of viewport
            height. */}
        <div className="flex flex-1 flex-col gap-2 overflow-hidden p-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Live transcript
          </div>
          <TranscriptScroll lines={liveTranscript} />
        </div>

        <div className="border-t border-payphone-border p-6">
          <EndCallButton settling={settling} onLeave={handleLeave} />
        </div>
      </aside>
    </div>
  );
}

/* ────────── Subcomponents ────────── */

/**
 * Pulsing payphone-orange "ON AIR" badge. Compact variant drops the
 * label text and keeps just the dot for tight spaces (mobile mini-bar).
 * When `settling`, dim the dot and swap the label to "Settling…" so the
 * UI clearly stops claiming the call is live.
 */
function OnAirBadge({ settling, compact = false }: { settling: boolean; compact?: boolean }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border ${
        settling
          ? 'border-payphone-border bg-payphone-surface text-payphone-ink-muted'
          : 'border-payphone-orange/30 bg-payphone-orange/10 text-payphone-orange'
      } px-2.5 py-1`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          settling ? 'bg-payphone-ink-muted/60' : 'animate-pulse bg-payphone-orange'
        }`}
        aria-hidden="true"
      />
      {!compact && (
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          {settling ? 'Settling' : 'On Air'}
        </span>
      )}
      {compact && settling && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
    </div>
  );
}

/**
 * Big "End call & settle" button. Used in both the mobile bottom CTA
 * row and the desktop sidebar footer. Disabled + spinner once the user
 * has clicked Leave (the M4 ticker-freeze path is on `endedAtSec`,
 * which we map to `settling` at the parent).
 */
function EndCallButton({ settling, onLeave }: { settling: boolean; onLeave: () => void }) {
  return (
    <button
      type="button"
      onClick={onLeave}
      disabled={settling}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-payphone-orange px-5 py-3 text-base font-semibold text-payphone-ink shadow-lg shadow-payphone-orange/20 transition-all hover:bg-payphone-orange/90 hover:shadow-xl hover:shadow-payphone-orange/30 disabled:cursor-not-allowed disabled:bg-payphone-orange/60 disabled:shadow-md"
    >
      {settling ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Settling on-chain…
        </>
      ) : (
        <>
          <PhoneOff className="h-4 w-4" aria-hidden="true" />
          End call &amp; settle
        </>
      )}
    </button>
  );
}

/**
 * Mobile-only collapsible transcript drawer. Toggles open via a
 * button click; when open shows the same scrollable list the
 * desktop sidebar uses. The `<details>` element would have worked,
 * but we want explicit state to drive the chevron rotation and to
 * keep mobile feeling app-like rather than HTML-form-like.
 */
function TranscriptCollapse({
  lines,
  open,
  onToggle,
}: {
  lines: TranscriptLine[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-payphone-border bg-payphone-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-payphone-surface-elevated/40"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-payphone-ink">
          <MessageSquare className="h-4 w-4 text-payphone-ink-muted" aria-hidden="true" />
          Live transcript
          <span className="rounded-full bg-payphone-surface-elevated px-2 py-0.5 text-xs text-payphone-ink-muted">
            {lines.length}
          </span>
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-payphone-ink-muted" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-payphone-ink-muted" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="max-h-[40vh] border-t border-payphone-border">
          <TranscriptScroll lines={lines} />
        </div>
      )}
    </div>
  );
}

/**
 * Scrollable transcript list. Auto-scrolls to the bottom when new
 * lines arrive (chat-style). Local lines (the buyer's own utterances)
 * tint payphone-blue; remote lines (the expert) stay neutral. The
 * `liveTranscript` cap of 200 lines in the parent keeps this list
 * cheap to render even on hour-long calls.
 */
function TranscriptScroll({ lines }: { lines: TranscriptLine[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever a new line arrives. Using
  // scrollHeight directly is simpler than scrollIntoView on the last
  // child and avoids reflow churn.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [lines.length]);

  if (lines.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <Radio className="h-5 w-5 text-payphone-ink-muted/40" aria-hidden="true" />
        <p className="text-xs text-payphone-ink-muted/70">
          Transcript will appear here as you talk.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex h-full flex-col gap-2 overflow-y-auto px-4 py-4 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-payphone-border [&::-webkit-scrollbar]:w-1.5"
    >
      {lines.map((l) => (
        <div key={l.id} className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-xs font-semibold ${
                l.isLocal ? 'text-payphone-blue' : 'text-payphone-orange'
              }`}
            >
              {l.speaker}
            </span>
            <span className="font-mono text-[10px] text-payphone-ink-muted/60">{l.ts}</span>
          </div>
          <p className="text-sm leading-relaxed text-payphone-ink">{l.text}</p>
        </div>
      ))}
    </div>
  );
}
