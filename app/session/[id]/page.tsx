/**
 * PayPhone — live session page (server component).
 *
 * Renders after the marketplace's startSession action has provisioned a
 * Daily room + DDB row. Fetches the row by id, normalizes against the
 * lifecycle states, and hands the room URL + ticker anchor to the
 * `<SessionRoom>` client component.
 *
 * Status branching:
 *   - AUTHORIZED / ACTIVE → render the room normally.
 *   - COMPLETED          → call already settled; bounce to recap so the
 *                          back button doesn't drop the user back into a
 *                          stale iframe.
 *   - SETTLE_FAILED      → still bounce to recap; the recap surfaces
 *                          the failure.
 *   - row not found      → 404.
 *   - unknown expert id  → fall back to a generic display; the on-chain
 *                          flow still works regardless of the seed lookup.
 *
 * The login proxy already gates this route, so we trust `getCurrentUser()`
 * to be non-null. We don't enforce that the current user is the same one
 * who started the session (M5 polish — for now multiple seeded users may
 * share a buyer wallet, and the fake auth means strict ownership checks
 * would block legitimate testing flows).
 *
 * M4.5 layout: the navbar and footer self-skip on `/session/<id>` (Phase
 * 2's route guards in `Navbar.tsx` / `Footer.tsx`), so the call is
 * immersive full-bleed. `<SessionRoom>` itself drives the responsive
 * mobile / desktop split (vertical stack on phone, 70/30 horizontal
 * split on `lg+`).
 */

import { notFound, redirect } from 'next/navigation';

import { SessionRoom } from '@/components/SessionRoom';
import { createMeetingToken } from '@/lib/daily';
import { getSession } from '@/lib/db';
import { findExpertById } from '@/lib/seed';

type SessionPageProps = {
  // Next 16 makes route-segment params an async Promise.
  params: Promise<{ id: string }>;
};

export default async function SessionPage({ params }: SessionPageProps) {
  const { id } = await params;
  if (!id) notFound();

  const session = await getSession(id);
  if (!session) notFound();

  // Already settled — go straight to recap.
  if (session.status === 'COMPLETED' || session.status === 'SETTLE_FAILED') {
    redirect(`/session/${session.session_id}/recap`);
  }

  const expert = findExpertById(session.expert_id);
  // Defensive fallback — the user could have edited seed.ts between
  // session creation and reload. Show a generic name rather than crash.
  const expertName = expert?.name ?? 'Expert';
  const expertSpecialty = expert?.specialty ?? 'Live consultation';

  // Mint a meeting token granting transcription-admin permission. Without
  // this, `call.startTranscription()` from the client silently no-ops
  // because URL-only joins don't carry that permission. We mint per
  // page-load (cheap REST call) instead of persisting in DDB —
  // tokens are scoped to this room and expire with it.
  //
  // If token mint fails, fall through with `null` — the call still works,
  // just without transcription. Recap will note an empty transcript.
  let hostToken: string | null = null;
  try {
    hostToken = await createMeetingToken({
      roomName: session.video_room_id,
      permissions: { canAdmin: ['transcription'] },
    });
  } catch (err) {
    console.warn('[session] failed to mint transcription token:', err);
  }

  return (
    <SessionRoom
      sessionId={session.session_id}
      roomUrl={session.video_room_url}
      roomToken={hostToken}
      expertName={expertName}
      expertSpecialty={expertSpecialty}
      initialBillableStartMs={session.billable_window_start_ms ?? null}
    />
  );
}
