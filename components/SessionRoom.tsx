/**
 * PayPhone — live session room (client component).
 *
 * Hosts the Daily.co video iframe + the live billing ticker + the
 * "what happens next" callouts. On mount: creates the iframe and joins
 * the room. On `joined-meeting`: kicks off realtime transcription
 * (Daily provides Deepgram under the hood, no extra config). On
 * `meeting.ended` (signalled either by the participant clicking Leave,
 * or by the room exp): the webhook on the server flips the session to
 * `COMPLETED`, which our 2-second poll picks up and we navigate to
 * the recap page.
 *
 * Cleanup is critical:
 *   - Destroy the Daily call object on unmount or it leaks an iframe
 *     instance per Strict Mode mount in dev.
 *   - Clear the polling interval too.
 *
 * Strict-mode-safe: the early-return on `callRef.current` avoids
 * double-creating the iframe in dev mode's intentional double-mount.
 */

'use client';

import DailyIframe, { type DailyCall } from '@daily-co/daily-js';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Ticker } from '@/components/Ticker';
import { Button } from '@/components/ui/button';

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
        showLeaveButton: true,
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

        // Daily broadcasts transcription events to EVERY participant's
        // call object — so both the buyer's tab and the expert's tab
        // each receive events for both speakers, and naive logging
        // produced 2x duplicates in DDB. Filter to local-participant
        // only: each tab POSTs only its own utterances. The other tab
        // posts the other participant's utterances. End result: each
        // utterance lands in DDB once.
        const localSessionId = call.participants().local?.session_id;
        if (e.participantId && localSessionId && e.participantId !== localSessionId) {
          return;
        }

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
        const speaker = e.participantId ?? 'speaker';
        const line = `[${hh}:${mm}:${ss}] ${speaker}: ${text}`;

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
  }, [roomUrl, roomToken, sessionId]);

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

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row lg:gap-6 lg:p-6">
      {/* Video iframe — fills available space; min-height keeps it usable on small screens. */}
      <div className="flex min-h-[60vh] flex-1 flex-col rounded-xl bg-payphone-ink/5 lg:min-h-0">
        <div ref={containerRef} className="flex flex-1 overflow-hidden rounded-xl" />
        {!joined && !error && (
          <div className="flex items-center justify-center gap-2 py-3 text-sm text-payphone-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Connecting to the room…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-payphone-border bg-payphone-surface p-3 text-sm text-red-600">
            {error}
          </div>
        )}
      </div>

      {/* Side panel: expert info + live ticker + leave hint. */}
      <aside className="flex flex-col gap-4 rounded-xl border border-payphone-border bg-payphone-surface p-5 lg:w-80">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-payphone-muted">
            On call with
          </p>
          <h2 className="mt-1 text-xl font-semibold text-payphone-ink">{expertName}</h2>
          <p className="text-sm text-payphone-muted">{expertSpecialty}</p>
        </div>

        <div className="flex flex-col gap-1 border-t border-payphone-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-payphone-muted">
            Running total
          </p>
          <div className="mt-1">
            <Ticker startedAt={startedAt} />
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-2 text-sm text-payphone-muted">
          <p>
            Hit <strong className="text-payphone-ink">Leave</strong> in the call to settle on-chain.
            Daily fires <code>meeting.ended</code> → server settles for the actual duration → this
            page redirects to your recap.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              void callRef.current?.leave();
            }}
          >
            Leave call
          </Button>
        </div>
      </aside>
    </div>
  );
}
