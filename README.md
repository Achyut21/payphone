# PayPhone

> An x402 paywall for time-metered video sessions with human experts.
> Built for **EasyA Consensus Miami 2026 — Agentic Track** (Coinbase + AWS).

A buyer-side AI agent autonomously authorizes "up to $X" via x402's `upto` scheme,
opens a Daily.co video room with a human expert, and settles for the actual call
duration in **one on-chain Permit2 transfer of USDC on Base**.

The pitch in three lines:

1. **Stripe physically can't do this** — Stripe's 30¢ + 2.9% minimum makes
   per-second billing impossible.
2. **x402 + `upto` turns per-second billing into one on-chain settlement.**
   One signature authorizes up-to, one tx settles the actual usage.
3. **The video call is the demo — the rail is the product.**

## Status

| Milestone | What it proves                                                | Status            |
| --------- | ------------------------------------------------------------- | ----------------- |
| **M0**    | CDP wallet + USDC funding pre-flight                          | ✅ done (May 5–6) |
| **M1**    | x402 round-trip on Base **Sepolia**, exact scheme             | ✅ done (May 6)   |
| **M2**    | Swap `exact` → `upto` (Permit2 witness) on Sepolia            | ✅ done (May 6)   |
| **M3**    | Daily.co video rooms + DDB + duration-derived settle          | ✅ done (May 6)   |
| **M4**    | Marketplace UI + live session + AI recap & chat               | ✅ done (May 6)   |
| **M4.5**  | UI/UX overhaul: dark mode landing + navbar + polish           | ✅ done (May 6)   |
| **M4.9**  | Bug fixes + active-window billing architectural fix           | ✅ done (May 7)   |
| **M5**    | Per-user Cognito auth + per-user CDP wallets + Amplify deploy | ✅ done (May 7)   |
| **M5.5**  | AI expert suggester + backup recap fallback + favicon         | ✅ done (May 7)   |
| M6        | Mainnet flip + on-stage live demo                             | next              |

### M1 proof

First successful PayPhone session, $0.10 USDC, Base Sepolia:

- **Tx:** `0xc09fa4bf006b1937b7efc66e54725e02b55c992ac9bb9cd9f99d2492817c47bc`
- **BaseScan:** <https://sepolia.basescan.org/tx/0xc09fa4bf006b1937b7efc66e54725e02b55c992ac9bb9cd9f99d2492817c47bc>
- **What happened on-chain:** $0.10 USDC moved from the buyer wallet
  `0xE01669A01E28E905055Ac6cD33c19ced7e10d870` to the seller wallet
  `0x5c15772fd9132F2EaaCe0c55638fB674b0BaFC71`. Gas paid by the CDP facilitator
  (`0x68a96f41ff1e9f2e7b591a931a4ad224e7c07863`).

### M2 proof

The pitch made real on-chain: **buyer authorized up to $5.00, server settled $0.30.**

- **Tx:** `0x3b2625f01acfb4a2b583e76a6441da9d1dfef4defb06a51873a2f36534f09cd1`
- **BaseScan:** <https://sepolia.basescan.org/tx/0x3b2625f01acfb4a2b583e76a6441da9d1dfef4defb06a51873a2f36534f09cd1>
- **maxAuthorized:** $5.00 — the value the buyer signed in the Permit2 witness
- **settled:** $0.30 — the value that actually moved on-chain
- **The asymmetry:** the buyer's EIP-712 signature was over
  `permitted.amount = 5_000_000` atomic, but the on-chain `Transfer` event
  shows only `300_000` atomic. The remaining $4.70 of allowance simply expires
  on the witness deadline. The x402UptoPermit2Proxy
  (`0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002`, the `…0002` vanity address)
  enforces `amount <= permitted.amount` on-chain via `AmountExceedsPermitted`,
  so the asymmetry is contract-enforced, not trust-based.
- **Gas-sponsorship:** the buyer's first-time `approve(Permit2)` was handled
  gaslessly by signing a USDC EIP-2612 permit (advertised by the server via
  the `eip2612GasSponsoring` extension). No buyer-side ETH or
  pre-approval tx was required. Gas paid by the CDP facilitator
  (`0x8F5cB67B49555E614892b7233CFdDEBFB746E531`, baked into the witness as
  the only address allowed to call `settle()`).

### M3 proof

The product made real: **buyer authorized up to $5.00, joined a Daily.co video room
with a friend, talked for 88 seconds, hung up, and the server settled $0.88 USDC
automatically.**

- **Tx:** `0xfc70cf0cc0f9142897c79c1a44ce7cf18bc20ccc7050f48b96e95d59ea29e781`
- **BaseScan:** <https://sepolia.basescan.org/tx/0xfc70cf0cc0f9142897c79c1a44ce7cf18bc20ccc7050f48b96e95d59ea29e781>
- **maxAuthorized:** $5.00 — same Permit2 witness as M2
- **duration_sec:** 88.36400008201599 — Daily-reported call duration
- **settled:** $0.88 — `floor(88.36) × 10_000 = 880_000` atomic units
  (`M3_PER_SECOND_RATE_ATOMIC = 10_000n`, i.e. $0.01/sec)
- **Why this is different from M2:** M2 settled a hardcoded $0.30. M3 settles
  whatever `duration × rate` evaluates to at meeting hangup. The settle amount
  is now a function of actual usage, not a value the server picked at request
  time. Stripe physically can't do this.
- **End-to-end flow:**
  1. Buyer agent posts to `/api/sessions` → server verifies upto signature,
     creates Daily.co room, persists session row to DynamoDB with
     `status: AUTHORIZED`, returns `{ sessionId, roomUrl }` (no on-chain
     activity yet).
  2. Buyer + expert join the Daily room, talk, hang up.
  3. Daily fires `meeting.ended` webhook to `/api/webhooks/daily` → HMAC-SHA256
     signature verified (Stripe-style `${timestamp}.${body}` variant) →
     `duration_sec` computed from `end_ts - start_ts` → `settleWithRetry` posts
     to the CDP facilitator → DDB row flips to `COMPLETED` via UpdateItem with
     conditional `status = AUTHORIZED` (the double-settle guard).

### M4 proof

PayPhone has a face: **a logged-in user browsed a marketplace, clicked an
expert, joined a live video room with a billing ticker counting up at $0.01/sec,
talked, hung up, and landed on a recap page with a streamed AI summary and a
follow-up chat — both grounded in the actual call transcript.**

- **Canonical session:** `c0a5c8df-abe5-4c88-97e3-72c606069b4f`
- **Tx:** `0x47dab9fe331741037730c4da1e1c1d46f2cfd5309db4311b3d57745739d6e33a`
- **BaseScan:** <https://sepolia.basescan.org/tx/0x47dab9fe331741037730c4da1e1c1d46f2cfd5309db4311b3d57745739d6e33a>
- **duration_sec:** 84.84 (Daily-reported) — **settled $0.84 USDC**
- **Transcript:** 61 lines captured to DDB during the call via Daily/Deepgram
  realtime transcription
- **Recap:** Claude Haiku 4.5 streamed a markdown summary (Topic / Key points /
  Action items / Open questions) and answered follow-up questions grounded in
  the transcript via a chat box
- **What's new vs M3:** the buyer is no longer a CLI script. A real browser-
  based flow runs the whole loop: cookie auth → marketplace → server action
  triggers the M3 x402 round-trip → live session page with iframe + ticker →
  realtime transcription captured client-side and POSTed to the server → recap
  page streams the LLM summary as soon as the call settles
- **End-to-end flow (browser, post-M4.5):**
  1. `GET /` → public marketing landing renders (hero, how-it-works, live
     last-call widget, expert preview). No cookie required.
  2. Click `Get started` (or any `Talk to ...` on the expert preview) → goes
     to `/login`. The `loginAction` server action sets the `payphone-user`
     cookie and 302s to `/marketplace`.
  3. `/marketplace` (cookie-gated by edge `proxy.ts`) — four seeded experts.
     Click "Talk to ..." → `<form action={startSession}>` runs the server
     action, which calls `lib/agent.ts` → `POST /api/sessions` → x402 verify
     against $5.00 max → Daily room created → DDB row written → redirect to
     `/session/[id]`
  4. Live session page server-side mints a meeting token with
     `permissions.canAdmin: ['transcription']`, hands it to `<SessionRoom>`
     which embeds the Daily iframe and starts realtime transcription. Client
     filters `transcription-message` events to local participant only (Daily
     broadcasts to all tabs; without the filter we get 2× duplicates) and
     POSTs each line to `/api/sessions/[id]/transcript`
  5. User clicks **Leave call** → ticker freezes at the displayed value →
     Daily's `meeting.ended` webhook → M3 settle path runs unchanged
  6. Status polling sees `COMPLETED` → `router.push('/recap')` → recap page
     streams the AI summary via `summarize()` → useChat-driven chat box
     answers follow-ups via `chatWithContext()`, both pinning the transcript
     as system context

### M4.5 proof

Same M4 backend, redesigned face. **No on-chain, no API, no DDB schema
changes — every M4 proof above still holds.** This milestone takes the
project from "wired prototype" to "submission-grade UI."

- **Routes reorganized.** `/` is now a public marketing landing (was the
  marketplace). `/marketplace` is the cookie-gated expert browse (was at
  `/`). `/docs` is a new public technical writeup. The login flow is now
  `/` → `/login` → `/marketplace` → call.
- **Dark-mode design system.** Custom palette (`payphone-bg #0A0A0A`,
  `payphone-blue #0052FF`, `payphone-orange #FF6B35`, `payphone-success
#10B981`, etc.) wired through Tailwind v4 tokens. Aceternity UI components
  (`AuroraBackground`, `BackgroundBeamsWithCollision`, `Spotlight`,
  `FloatingNavbar`) recolored to the palette and used for hero/marketplace/
  recap/login backgrounds.
- **Sticky floating navbar** with active-route underline, mobile drawer,
  user pill with logout. Self-skips on the immersive `/session/<id>` page.
- **Marketing landing** (`/`) — `BackgroundBeamsWithCollision` hero,
  how-it-works 3-card breakdown, **live last-call widget** server-fetched
  via the new `getLatestCompletedSession()` helper (falls back to the M4
  canonical session when no fresh settled rows exist), built-on badges
  (Base, Daily, Coinbase, Anthropic, AWS), expert preview row.
- **Docs page** (`/docs`) — TLDR, hand-rolled SVG architecture diagram with
  three phases (AUTHORIZE / TALK / SETTLE), 4-card RATIONALE block,
  4-card MILESTONES block linking out to M1/M2/M3/M4 BaseScan transactions,
  TECH_STACK table, MITIGATIONS list, open-source footer.
- **Live session page** (`/session/<id>`) redesign — mobile vertical stack
  with sticky `$X.XX` mini-bar, desktop 70/30 horizontal split with sticky
  ticker sidebar, ON AIR badge with pulsing dot, in-call live transcript
  panel showing both speakers (additive over M4, doesn't change DDB POST
  invariant), big payphone-orange "End call & settle" button.
- **Recap page** (`/session/<id>/recap`) redesign — settle status card with
  pulsing payphone-success "Settled on-chain" badge, big mono `$X.XX · m:ss`
  display, BaseScan link in payphone-orange chip, AI summary card with
  `Sparkles` eyebrow, follow-up chat with payphone-blue user bubbles.
- **Mobile-first throughout.** Hamburger button bumped to 44×44 (Apple
  HIG), responsive grids start at `grid-cols-1`, headlines use
  `text-balance` for natural reflow, container max-w + padding consistent
  across all six pages.
- **Backend wiring preserved verbatim.** `SessionRoom.tsx` and `Recap.tsx`
  redesigns rewrote JSX while keeping every effect / state / event handler
  byte-for-byte identical to M4 — Strict-Mode-safe Daily singleton, all
  four transcription listeners, local-participant POST de-dup filter, 2s
  status poll, ticker freeze, streaming summary fetch + AbortController,
  `useChat` + `DefaultChatTransport`, auto-scroll. The M4 canonical session
  `c0a5c8df-...` (84.84s, $0.84, tx `0x47dab9fe...`) remains the
  source-of-truth proof that the call → settle → recap → chat path works.

### M4.9 proof

A bug-fix + edge-case milestone between M4.5 (UI redesign) and M5 (mainnet
flip), addressing four issues that surfaced during M4.5 dogfooding: a
Daily strict-mode race causing the "Connecting…" overlay to stick, the
buyer's ticker continuing to count after the OTHER party left, per-second
billing starting from session creation rather than from when both parties
were actually present, and on-chain settle waiting for `meeting.ended`
(room fully empty) rather than firing on the first leave.

**Backend & math.**

- **Active-window billing** (`lib/billing.ts`, NEW). Two pure functions —
  `computeBillableWindow(events)` and `activeWindowDurationSec(events, nowMs?)`
  — derive `{start_ms, end_ms}` from a `ParticipantEvent[]` log. Window
  opens the first instant participant count reaches 2 and closes the
  first instant it drops below 2. Set-replay strategy makes both functions
  idempotent under Daily's at-least-once webhook delivery and commutative
  under timestamp-sort (delivery order doesn't change the answer). The
  on-chain settle and the buyer's displayed ticker now derive from the
  SAME math — they cannot disagree.
- **Webhook handler rewrite** (`app/api/webhooks/daily/route.ts`). Three
  handlers behind a `switch` over event type. `participant.joined` /
  `participant.left` append to the event log, recompute the window, open
  or close the boundary via idempotent setters (`attribute_not_exists`),
  and on first window-close fire settle via a single `fireSettleAndPersist`
  funnel. `meeting.ended` is now an idempotent ack — short-circuits to
  `200` if the row already settled.
- **DDB schema extensions** (`lib/db.ts`). New columns: `participant_events`,
  `billable_window_start_ms`, `billable_window_end_ms`, `started_at_ms`.
  New status: `TIMEOUT`. New helpers, all idempotent: `appendParticipantEvent`,
  `setBillableWindowStart`, `setBillableWindowEnd`, `markSessionActive`
  (AUTHORIZED → ACTIVE), `markSessionTimedOut` (gated on no window-start),
  `markSessionFailed` (settle-failed branch), `markSessionRetrySettled`
  (SETTLE_FAILED → COMPLETED for manual retry).
- **90-second no-expert timeout**. Implemented lazily in the status route
  — when a polled session is still AUTHORIZED with no `billable_window_start_ms`
  past 90s, transitions to `TIMEOUT` on the next poll. No background job,
  no scheduler — picks up free off the existing 2s client poll.
- **`/session/[id]/timeout` page** (NEW). Server-rendered, status-branched,
  AuroraBackground + clear "no funds moved on-chain" reassurance + single
  "Back to marketplace" CTA.
- **Manual retry-settle** (`POST /api/sessions/[id]/retry-settle`, NEW).
  Auth-gated, idempotent endpoint reachable from a "Retry settlement"
  button on the recap when the row landed in `SETTLE_FAILED`. Reconstructs
  settle requirements with the row's persisted `duration_sec` so the
  retry settles for exactly the same amount the buyer originally saw.

**The hardest bug — "Connecting to the room…" sticking.** Diagnostic
console logs revealed that React 19 strict mode + Daily's iframe SDK
interact pathologically:

1. Mount 1 calls `DailyIframe.createFrame()`, starts `await call.join()`.
2. React strict-mode cleanup synchronously fires `void call.destroy()`.
3. Mount 2 sees the call in `'loading'` state, awaits `existing.destroy()`.
4. Mount 2 **hangs** because Daily's `destroy()` postMessage to its iframe
   never gets ack'd while the iframe is mid-join (the cross-origin
   postMessage errors in the console were the symptom).
5. Mount 1's `join()` actually completes — Daily IS connected, video IS
   rendering — and Mount 1's listeners DO fire, but they all see Mount 1's
   `cancelled === true` and return early. `setJoined(true)` is never
   called. Daily connected, React state thinks not. Overlay sticks.

The fix is the **deferred-destroy + reuse pattern**: a module-scoped
`pendingDestroyTimeout` that defers destroy 200ms; the next mount cancels
it and REUSES the existing call instead of trying to destroy + recreate.
For real navigation (no remount within 200ms), the destroy fires normally.
Production behavior unchanged — strict-mode-only quirk fixed.

**UX polish.**

- **Buyer rename Alice → Achyut** to remove the on-stage visual collision
  with seeded expert "Alice Chen". Cookie `id: 'alice'` kept stable so
  existing auth cookies and DDB rows continue to resolve.
- **`readableError(err)` helper** in `SessionRoom.tsx` walks Daily's
  plain-object error shapes (`{errorMsg, error: {msg, type}}`) so failures
  render as e.g. `join failed: The meeting is full` instead of
  `join failed: [object Object]`.
- **`participant-left` listener** added (distinct from the existing
  `left-meeting` for the local user) so the buyer's ticker freezes the
  instant the OTHER party leaves and the sidebar shows
  `{expertName} left the call. Settling on-chain…`.

**Tests.** `scripts/test-active-window.ts` (NEW, 164 lines) — 8 unit
tests via Node 22's built-in `node:test` runner under `tsx`. Zero new
runtime deps. ~96ms total. All 8 pass on every commit. See
[Testing](#testing) for the case list.

**QA — 9 manual scenarios run on dev (`pnpm dev` + ngrok), 9/9 pass.**

| #   | Scenario                                                        | Result                                                                                                                                                                                   |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Happy path — buyer joins, expert joins, talk, buyer ends        | ✅ Ticker `$0.00 / Waiting` (gray) until expert joins, then blue ticking; freeze on End; recap matches active-window duration × \$0.01.                                                  |
| 2   | Buyer leaves first (clicks End)                                 | ✅ Both tabs freeze; recap renders with correct duration.                                                                                                                                |
| 3   | Expert leaves first                                             | ✅ Buyer's ticker freezes immediately via `participant-left`; sidebar shows "{expert} left the call. Settling on-chain…"; auto-redirect to recap.                                        |
| 4   | Tab close without End button                                    | ✅ Daily fires `participant.left` automatically via `navigator.sendBeacon`; server-side flow identical to #2/#3.                                                                         |
| 5   | Both close simultaneously                                       | ✅ Idempotent `setBillableWindowEnd` ensures only the first leave's timestamp wins; settle fires from the first leave; `meeting.ended` arrives later as a no-op ack.                     |
| 6   | 90s no-expert timeout                                           | ✅ Buyer joins alone; after 90s status route's lazy timeout fires; row → `TIMEOUT`; client polling navigates to `/session/[id]/timeout` page; no on-chain effect (Permit2 just expires). |
| 7   | Third tab tries to join 2-person room                           | ✅ Daily enforces `max_participants: 2`; third joiner's `call.join()` rejects; UI displays `join failed: The meeting is full`; original two-person settle proceeds normally.             |
| 8   | Connecting overlay verification across multiple expert switches | ✅ Validated across 6+ expert switches in scenarios 1-6 — overlay dismisses cleanly every time after the deferred-destroy + reuse fix.                                                   |
| 9   | Mobile (375px) responsive layout                                | ✅ M4.5 already validated the responsive layout at 375px; M4.9 made no JSX layout changes (state-management only), so the responsive design is preserved end-to-end.                     |

**On-chain proof.** Multiple successful settles during scenario 1-3
testing — buyer wallet `0xE01669A01E28E905055Ac6cD33c19ced7e10d870` had
$22.05 USDC on Base Sepolia at session start (no top-up needed); each
settle deducted exactly the active-window duration × $0.01. The M4
canonical session and BaseScan links carry over verbatim — M4.9 didn't
change the on-chain math, only **when** it fires and **which seconds**
it counts.

### M5 proof

PayPhone is live in production at
**<https://main.d3vbs5akc8zis2.amplifyapp.com>**.

Anyone can sign up via Cognito Hosted UI, get a freshly provisioned per-user
CDP wallet, top it up with one click via the Sepolia USDC faucet, and run
a real two-party video call that settles on-chain — exactly the same rail
as M4.9, but with no shared dev wallet and no localhost.

The "make it real for everyone, not just Achyut" milestone. M0–M4.9 ran on
a single hardcoded `payphone-buyer` CDP wallet authenticated via a
cookie-based seeded login (three demo personas — Achyut/Bob/Charlie — that
anyone visiting localhost could pick from). M5 swaps that for AWS Cognito
sign-up/sign-in, gives every Cognito user their own server-managed CDP
wallet provisioned lazily on first session, lets them top it up with a
one-click testnet faucet, locks down session resources to their owner, and
ships the whole thing to AWS Amplify Hosting. The Achyut demo account is
preserved as a one-row DDB migration that points his Cognito sub at the
existing M0-funded wallet, so the on-stage Sepolia demo still uses the
funded address with no surprise.

**Auth & per-user wallets.**

- **AWS Cognito user pool + Hosted UI** (`infra/terraform/cognito.tf`, NEW).
  `aws_cognito_user_pool` with email username + auto-verification, `aws_cognito_user_pool_domain` for the Hosted UI redirect destination, and `aws_cognito_user_pool_client` (confidential client with `generate_secret = true`, `code` OAuth flow, `openid email profile` scopes). `terraform apply` produced pool `us-east-1_LpxZibNkY` and client `7e7slec78v8u0t9obg9jj13h0f`.
- **NextAuth v5 (beta) + Cognito provider** (`auth.ts`, NEW). Module-level
  factory exporting `auth` / `signIn` / `signOut` / `handlers` to the rest
  of the app. JWT strategy (no DB sessions) with a `session` callback that
  surfaces `token.sub` as `session.user.id`. `trustHost: true` is mandatory
  behind ngrok / Amplify CloudFront / any reverse proxy.
- **Per-user CDP wallets, lazy** (`lib/user-wallet.ts`, NEW). New DDB table
  `payphone-users` (hash key `cognito_sub`). `getOrCreateUserWallet` does a
  fast-path read; on miss, calls CDP's idempotent `getOrCreateAccount({ name })` first, then a conditional `Put` (race-safe: two concurrent first-session requests both end up with the same wallet via CDP's idempotency, only one row gets written, the loser re-reads the winner's row). Wallets are NOT created at signup — only on the first action that needs one (first balance fetch, first faucet click, first session).
- **Wallet name 36-char fix.** CDP enforces 2..=36 character wallet names.
  The natural `payphone-user-${cognito_sub}` is 50 chars and rejected.
  `walletNameFor(sub)` hashes via `createHash('sha256').slice(0, 16)` and
  prefixes `payphone-`, producing a deterministic 25-char name like
  `payphone-a3b8c92ff1e240d8`. Birthday-paradox collision threshold ≈ 4
  billion accounts.
- **Achyut migration** (`scripts/migrate-achyut.ts`, NEW). One-time DDB row
  pointing the demo account's Cognito sub at the M0-funded
  `payphone-buyer` wallet so the on-stage Sepolia demo doesn't need a
  faucet refill. Idempotent via `attribute_not_exists` condition.

**Faucet, balance, network signaling.**

- **`/api/users/me/balance`** (NEW). GET endpoint returning the
  authenticated user's wallet address + USDC balance. viem `readContract`
  against `ACTIVE_USDC_ADDRESS` on the active network.
- **`/api/users/me/faucet`** (NEW). POST endpoint that drips 10 Sepolia
  USDC via `cdp.evm.requestFaucet({ network: 'base-sepolia', token: 'usdc' })`.
  Mainnet guard rejects with 400. On rate-limit / 24h quota exhaustion,
  returns 503 with `fallback_url: 'https://faucet.circle.com/'` so the
  user has a manual recovery path.
- **`<WalletPanel />` on `/marketplace`** (`components/WalletPanel.tsx`,
  NEW). Polls balance every 8s, shows truncated address + BaseScan link,
  conditionally renders the orange "Fund my wallet" button when
  `balanceUsd < $5 && ACTIVE_NETWORK === 'sepolia'`.
- **Network badge in the navbar.** Inline pill rendering "Base Sepolia"
  (orange) or "Base Mainnet" (success-green). Driven entirely off
  `ACTIVE_NETWORK`, which now reads from
  `process.env.NEXT_PUBLIC_ACTIVE_NETWORK ?? 'sepolia'` — the
  `NEXT_PUBLIC_` prefix matters because the badge consumes it client-side.
- **Honest pricing.** All four expert cards now read `$0.60/min` (matches
  the on-chain settle rate). Previously `$2/min`, `$3/min`, `$2/min`,
  `$4/min` — flavor that contradicted what BaseScan would show.

**Session ownership guards** (`lib/session-auth.ts`, NEW). Two helpers
covering both API routes and server pages. `requireSessionOwner(sessionId)`
returns either the row or a 401/404 NextResponse to surface verbatim; non-
owner gets the SAME 404 as a missing session so we don't leak existence.
`requireSessionOwnerForPage` redirects to `/marketplace` instead. Applied
to all five `/api/sessions/[id]/*` routes (`recap`, `chat`, `transcript`,
`status`, `retry-settle`) plus the three `/session/[id]/*` server pages.
Cross-user URL probing now silently bounces.

**Amplify deployment.**

- **`amplify.yml`** (NEW). Pins Node 22 via `nvm install 22 && nvm use 22`
  (above Next 16's 20.9+ floor), pins pnpm to `10.33.3` via corepack,
  installs with `--frozen-lockfile`. The build phase ALSO runs
  `env | grep -E '^(COGNITO_|CDP_|...)' >> .env.production` to forward
  Console-set env vars into Next.js's SSR runtime — Amplify does NOT do
  this automatically, and without that line every server-side
  `process.env.X` read returns undefined in production.
- **`APP_AWS_*` env-var aliases** (`lib/db.ts`, updated). Amplify reserves
  the entire `AWS_*` env-var prefix and refuses to let you set
  `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` at config
  time. `resolveAwsConfig()` reads `APP_AWS_*` first, falls back to
  `AWS_*`. Credentials are now passed explicitly to the
  `DynamoDBClient` constructor rather than relying on the SDK's default
  credential provider chain.
- **Cognito callback URL update**. The Amplify-issued production URL
  appended to `aws_cognito_user_pool_client.callback_urls` and
  `logout_urls` via `infra/terraform/cognito.tf`.
- **Daily webhook re-registration**. Re-ran
  `scripts/register-daily-webhook.ts` against the Amplify URL — the
  script's stale-cleanup logic auto-deleted the M3-era ngrok webhook,
  registered a new one, and returned a fresh HMAC secret which now lives
  in Amplify's `DAILY_WEBHOOK_SECRET` env var.

**End-to-end verification.** User signed in as Achyut on
`https://main.d3vbs5akc8zis2.amplifyapp.com`, opened a session in one tab,
joined the same Daily room URL in a second tab simulating the expert,
talked for ~20 seconds, hung up. Daily's `participant.left` webhook hit
the Amplify route, HMAC verified against the fresh secret, fired settle,
on-chain tx landed on Base Sepolia, row transitioned to COMPLETED, buyer
was navigated to the recap with a working BaseScan link. The whole rail
works end-to-end on production with real Cognito users + per-user wallets

- real Daily webhooks + real on-chain settle.

### M5.5 proof

Three small stretch-goal additions on top of the M5 production deployment, landing
demo-day morning. **Committed as a single combined commit (`feat(m5.5): ai expert
suggester + backup recap fallback + favicon`, hash `836128a`) per explicit user
direction** — CONTEXT.md's commit-per-phase cadence rule was overridden for this
milestone only, not abandoned. Future milestones revert to the per-phase cadence.

**AI expert suggester** (`docs/STRETCH_GOALS.md` #2). A free-form chat input
above the marketplace expert grid. The user types what they need help with
("I'm stuck on a gas optimization issue in my Solidity contract") and Haiku 4.5
picks the single best-matching seeded expert. New `app/api/experts/suggest/route.ts`
POST endpoint, NextAuth-gated via `getCurrentUser()`. Calls `@anthropic-ai/sdk`
directly (rather than the Vercel AI SDK we use for the recap stream — this is a
one-shot non-streaming JSON response, `streamText` would be overkill). The system
prompt embeds the four `DEMO_EXPERTS` ids/specialties/bios at request time so it
stays in sync with `lib/seed.ts`; the response is parsed as strict JSON
`{expertId, reason}`, accidental code fences are stripped, and the returned
`expertId` is validated against the seed list before responding (defends against
hallucinated ids). Failures surface as 502 with a generic `error` field; the
client falls back to "pick from the list below". UX: new
`components/ExpertSuggester.tsx` (Sparkles icon, payphone-blue submit button,
Loader2 spinner during pending, `useTransition`, orange-tinted error fallback).
New `components/MarketplaceClient.tsx` is a thin client wrapper that holds
`{expertId, reason}` state and threads `isSuggested` / `suggestedReason` into
each card. `components/ExpertCard.tsx` was converted from a Server to a Client
Component (server actions called via `<form action={startSession}>` work fine
from Client Components in Next 16); when matched, the card border tints
payphone-orange, a "Suggested" badge with the model's reason renders next to
the expert name, and a `useEffect` + `requestAnimationFrame` defers
`scrollIntoView({ behavior: 'smooth', block: 'center' })` until after the badge
renders (prevents a janky frame where mobile scrolls before the badge mounts).

**Backup recap fallback.** When the recap loads and the session's transcript is
empty or under 50 characters (e.g. the user hung up before the second tab joined,
or Daily transcription flaked on stage WiFi), `lib/haiku.ts` now switches
`summarize()` to a fallback prompt that generates a coherent recap from the
expert's specialty + call duration alone — framed as "what an expert in this
domain typically helps with" rather than "we have no transcript". The streaming
shape, return type, and `useCompletion`-style client renderer in
`components/Recap.tsx` are unchanged — only the system prompt and user-message
body branch on `transcriptText.trim().length < MIN_TRANSCRIPT_CHARS`. New
constants: `MIN_TRANSCRIPT_CHARS = 50` (empirically picked: a single "hello" is
~5–7 chars after our `[hh:mm:ss] speaker:` prefix, so anything under 50 has
effectively no substance for Haiku to summarize). The fallback prompt produces
a different four-section structure (Brief call recap / What [Expert] typically
helps with / Suggested next steps) — the recap UI renders raw markdown via
markdown-it, so any heading shape works. `app/api/sessions/[id]/recap/route.ts`
was extended to pass `expertSpecialty` (falls back to `'general consulting'`
for legacy rows that predate `expert_id` tracking) and `durationSec` (falls
back to `0`) into `summarize()`.

**Favicon.** New PayPhone favicon (15406-byte ICO) replaces the previous
25931-byte placeholder at `app/favicon.ico`. Next.js 16 App Router serves
favicons from this canonical path automatically.

**End-to-end verification.** User signed in as Achyut on `localhost:3000`,
confirmed the new favicon visible in the browser tab, typed a free-form query
into the suggester, watched the marketplace scroll to the matching card with
the "Suggested" badge + reason, clicked "Talk to ..." → started a session →
hung up immediately before the second tab joined (empty transcript), landed
on `/session/<id>/recap` and watched the fallback summary stream in coherently
with the expert's specialty + duration. The settled amount + BaseScan link
rendered correctly even on the empty-transcript path. All three additions
verified working end-to-end before the commit landed.

**Build/lint/test hygiene.** `pnpm format && pnpm lint && pnpm build && pnpm test`
clean before the commit. Production build registers 19 routes (M5 had 18; +1
for `/api/experts/suggest`). 8/8 active-window unit tests still pass.

## Stack

- **Next.js 16** App Router, **TypeScript** strict
- **CDP Server Wallets v2** ("Agentic Wallets") + **CDP x402 Facilitator**
- **`@x402/core`, `@x402/evm`, `@x402/fetch`** (x402 protocol v2)
- **viem** for on-chain reads
- **Daily.co** for video rooms + realtime transcription (Deepgram nova-2)
- **AWS DynamoDB** for session state (Terraform-managed)
- **AWS Amplify Hosting** for production deploy (M5)
- **Tailwind v4** + **shadcn/ui** + **Lucide React** for the marketplace + session + recap UI
- **Anthropic Claude Haiku 4.5** via **Vercel AI SDK v6** for the streaming recap + follow-up chat
- **markdown-it** for rendering the recap (the React-Markdown / marked ESM-only chain doesn't compose with Next 16's CJS pipeline)
- **pnpm**

## Architecture

```
   ┌──────────────────┐         ┌──────────────────┐
   │  buyer-agent.ts  │         │   Browser (M4)   │
   │  (CDP wallet)    │         │  proxy.ts → /    │
   └────────┬─────────┘         │  marketplace →   │
            │                   │  startSession    │
            │                   │  (server action) │
            │                   └────────┬─────────┘
            │   POST /api/sessions       │
            │   (PAYMENT-SIGNATURE)      │
            ▼                            ▼
   ┌─────────────────────────────────────────────────────────┐
   │              Next.js (Node runtime)                     │
   │                                                         │
   │  /api/sessions ───────┬─► verify (CDP facilitator)      │
   │                       ├─► createRoom (Daily.co REST)    │
   │                       ├─► createSession (DynamoDB)      │
   │                       └─► return { sessionId, roomUrl } │
   │                                                         │
   │  /session/[id]  (M4)  ─► createMeetingToken (Daily)     │
   │                       └─► <SessionRoom> iframe + ticker │
   │                                                         │
   │  /api/sessions/[id]/transcript (M4)                     │
   │                       └─► appendTranscript (DDB)        │
   │                                                         │
   │  /api/webhooks/daily ◄── meeting.ended (HMAC-signed)    │
   │                       ├─► verifyWebhookSignature        │
   │                       ├─► getSessionByRoomId (DDB)      │
   │                       ├─► settleWithRetry (CDP)         │
   │                       └─► markSessionCompleted (DDB)    │
   │                                                         │
   │  /session/[id]/recap (M4)                               │
   │                       └─► <Recap> with streamed         │
   │                           summary + follow-up chat      │
   │  /api/sessions/[id]/recap (M4) ─► Haiku streamText      │
   │  /api/sessions/[id]/chat  (M4) ─► Haiku streamText      │
   └─────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                              Base Sepolia (M1–M4) /
                              Base Mainnet (M5)
                              + USDC Transfer for ACTUAL duration × rate
```

## Quick start

You'll need:

- Node 24 (we use nvm)
- pnpm 10 (`corepack enable pnpm`)
- An AWS account (free tier works; pre-flight: `terraform`, `awscli`)
- An ngrok account (free tier; for local Daily webhook tunneling)
- A Daily.co account
- A `.env.local` at the project root containing:
  - `CDP_API_KEY_ID`
  - `CDP_API_KEY_SECRET`
  - `CDP_WALLET_SECRET`
  - `DAILY_API_KEY`
  - `DAILY_WEBHOOK_SECRET` (M3+, set by `register-daily-webhook.ts`)
  - `AWS_REGION` (M3+, populated by `terraform output`)
  - `DYNAMODB_TABLE_NAME` (M3+)
  - `AWS_ACCESS_KEY_ID` (M3+, scoped runtime user)
  - `AWS_SECRET_ACCESS_KEY` (M3+)
  - `ANTHROPIC_API_KEY` (M4+)

### One-time AWS setup (M3+)

```bash
brew install terraform awscli
# Create a temporary AdministratorAccess IAM user 'payphone-bootstrap' in
# the AWS Console, then:
aws configure                                # paste bootstrap keys, region us-east-1

cd infra/terraform
terraform init
terraform apply                              # creates DDB table + scoped runtime user

# Extract runtime credentials into .env.local (never paste keys into chat).
echo "AWS_REGION=$(terraform output -raw aws_region)" >> ../../.env.local
echo "DYNAMODB_TABLE_NAME=$(terraform output -raw dynamodb_table_name)" >> ../../.env.local
echo "AWS_ACCESS_KEY_ID=$(terraform output -raw app_access_key_id)" >> ../../.env.local
echo "AWS_SECRET_ACCESS_KEY=$(terraform output -raw app_secret_access_key)" >> ../../.env.local

# Delete the bootstrap user from the AWS Console once apply succeeds —
# it had AdministratorAccess for the bootstrap only. The runtime
# 'payphone-app' user has DDB-only scope.
```

### M1/M2: bare round-trip

```bash
pnpm install

# Resolve the buyer wallet (idempotent — same address every run)
pnpm tsx scripts/wallet-setup.ts

# Top up Sepolia USDC if needed (CDP faucet)
pnpm tsx scripts/fund-check.ts                            # check balance
pnpm tsx scripts/fund-check.ts --top-up                   # top up to $1 (M1 minimum)
pnpm tsx scripts/fund-check.ts --top-up --target=5.5      # top up to $5.50 (M2/M3: verify needs ≥ MAX)

# Start the server
pnpm dev

# In another terminal, drive the round-trip
pnpm tsx scripts/buyer-agent.ts
```

For M1/M2 you should see `HTTP 200 OK` with `paymentTx` (M1) or `maxAuthorized`+`settled`
(M2). For M3 you'll see `roomUrl` instead — keep reading.

### M3: video session end-to-end

Three terminals plus your browser.

**Terminal 1** — dev server:

```bash
pnpm dev
```

**Terminal 2** — ngrok tunnel (Daily needs a public HTTPS URL for webhooks):

```bash
ngrok http --url=<your-ngrok-domain>.ngrok-free.dev 3000
```

**Terminal 3** — register the webhook (one time per ngrok URL):

```bash
pnpm tsx scripts/register-daily-webhook.ts \
    https://<your-ngrok-domain>.ngrok-free.dev/api/webhooks/daily
# → prints DAILY_WEBHOOK_SECRET; save to .env.local; restart Terminal 1.
```

**Terminal 3 again** — drive the session:

```bash
pnpm tsx scripts/fund-check.ts --top-up --target=5.5      # ensure ≥ $5
pnpm tsx scripts/buyer-agent.ts                           # creates session + room
```

The buyer agent prints a `roomUrl`. Open it in **two browser tabs**, both join,
talk for ~30–60 seconds, then click "Leave" in either tab. Within ~20 seconds
Daily fires `meeting.ended` to your webhook, which settles on-chain.

```bash
pnpm tsx scripts/inspect-session.ts <sessionId>           # printed by buyer-agent
# → prints DDB state including BaseScan URL for the settle tx.
# Add --transcript to also dump the captured lines.
```

### M4: full browser flow (landing → marketplace → live call → recap + chat)

Same three-terminal setup as M3 (dev server + ngrok + Daily webhook registered).
The buyer is no longer the CLI — the whole loop runs in the browser.

```bash
# Make sure ANTHROPIC_API_KEY is in .env.local (M4 needs it for the recap LLM).
# All M3 setup (DDB, Daily webhook, ngrok) carries over unchanged.

pnpm tsx scripts/fund-check.ts --top-up --target=5.5      # ensure ≥ $5
pnpm dev                                                  # Terminal 1
ngrok http --url=<your-ngrok-domain>.ngrok-free.dev 3000  # Terminal 2
```

Then open <http://localhost:3000/> in your browser:

1. **Landing page** (`/`) — public marketing page with the live last-call
   widget. Click `Get started` in the navbar (or any expert preview card)
   to proceed.
2. **Login** (`/login`) — pick one of the four seeded users (Alice / Bob /
   Charlie / Diana). Cookie auth, no password (the seeded users aren't a
   security boundary — they're a demo aid). Redirects to `/marketplace` on
   success.
3. **Marketplace** (`/marketplace`, cookie-gated) — four seeded experts
   (Solidity, Rust, UX, DevOps). Click **Talk to ...** on any card.
4. **Live session** — Daily iframe loads, ticker counts up at $0.01/sec in
   the sticky sidebar (desktop) or top mini-bar (mobile), ON AIR badge
   pulsing in the corner. Open the same `/session/<id>` URL in a second
   tab/browser to act as the expert. Talk for ~30–60 seconds. The transcript
   is captured in real time, displayed in the in-call panel, and POSTed to
   the server.
5. Click **End call & settle** — the ticker freezes immediately at the
   displayed value (which is what the on-chain settle will use).
6. **Auto-redirect to recap** — within ~5–15s the webhook fires, settle
   completes, and the page navigates to `/session/<id>/recap`. The Haiku
   summary streams in (Topic / Key points / Action items / Open questions),
   followed by a chat box where you can ask follow-up questions about the
   call (every answer is grounded in the captured transcript).
7. **BaseScan link** in the recap header takes you to the on-chain settle.

For a quick architectural overview without running the demo, visit `/docs` —
public, no auth required, includes an SVG architecture diagram and links to
each milestone's BaseScan transaction.

Inspect any session you've created from the browser:

```bash
pnpm tsx scripts/inspect-session.ts <sessionId> --transcript
```

`<sessionId>` shows in the URL bar of `/session/<id>` and `/session/<id>/recap`.

### M4.9: bug-fixes + active-window billing (verification run)

Same setup as M4. M4.9 changed the webhook event subscription list, so on
first run after pulling this version **re-register the Daily webhook**:

```bash
pnpm tsx scripts/register-daily-webhook.ts https://<your-ngrok-domain>.ngrok-free.dev/api/webhooks/daily
# → prints a fresh DAILY_WEBHOOK_SECRET; rotate it in .env.local; restart pnpm dev.
```

Then run the unit tests and a happy-path session:

```bash
pnpm test                                                 # 8/8 active-window math tests, ~96ms
pnpm dev                                                  # Terminal 1
ngrok http --url=<your-ngrok-domain>.ngrok-free.dev 3000  # Terminal 2
```

Open the marketplace → click an expert → talk in two tabs → End. The
ticker should sit at `$0.00 / Waiting` in muted gray until the second
participant joins, then start counting up. End the call, watch it freeze,
recap shows the active-window duration × \$0.01. See the Status →
[M4.9 proof](#m49-proof) table for the full nine-scenario QA matrix.

## Diagnostics

Living under `scripts/`:

| Script                      | What it does                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `wallet-setup.ts`           | Resolves the buyer CDP wallet (idempotent)                                                                           |
| `fund-check.ts`             | Reads buyer Sepolia USDC + ETH balance; `--top-up --target=N` faucet loop                                            |
| `buyer-agent.ts`            | Drives the x402 round-trip end-to-end, prints `roomUrl` for M3                                                       |
| `register-daily-webhook.ts` | Idempotent register/replace of the Daily `meeting.ended` webhook                                                     |
| `inspect-session.ts`        | Reads a DDB session row by id; prints BaseScan URL when settled; `--transcript`/`-t` dumps captured transcript lines |
| `probe-supported.ts`        | Lists the (scheme, network) pairs the CDP facilitator advertises                                                     |
| `probe-usdc.ts`             | Reads `name`/`version`/`DOMAIN_SEPARATOR` etc. from USDC on-chain                                                    |
| `verify-tx.ts`              | Inspects a tx receipt + decodes USDC `Transfer` events                                                               |
| `test-active-window.ts`     | (M4.9) Unit tests for `lib/billing.ts` active-window math + settle-amount cap. Run via `pnpm test`.                  |

## Layout

```
app/
  page.tsx                            (M4.5) public marketing landing — hero, how-it-works, live last-call, expert preview
  marketplace/page.tsx                (M4.5) Cognito-gated expert browse (M5: also mounts <WalletPanel />)
  docs/page.tsx                       (M4.5) public docs page — architecture diagram, milestones, tech stack
  layout.tsx                          root layout, metadata, fonts, Navbar/Footer (suppressHydrationWarning on body)
  globals.css                         Tailwind v4 @theme + payphone M4.5 tokens + typography plugin + aurora keyframe
  login/page.tsx                      (M5) Cognito Hosted UI sign-in (server action signIn('cognito'))
  _actions/session.ts                 (M4) startSession server action — kicks off /api/sessions
  _actions/auth.ts                    (M5) signOut server action — calls NextAuth signOut
  session/[id]/page.tsx               (M4) live session page — M5: ownership-gated via requireSessionOwnerForPage
  session/[id]/recap/page.tsx         (M4) post-call recap page — M5: ownership-gated
  session/[id]/timeout/page.tsx       (M4.9) no-expert-joined timeout page — M5: ownership-gated
  api/auth/[...nextauth]/route.ts     (M5) NextAuth handlers (GET/POST) re-exported from auth.ts
  api/users/me/balance/route.ts       (M5) GET — authenticated user's wallet address + USDC balance (viem readContract)
  api/users/me/faucet/route.ts        (M5) POST — drip 10 Sepolia USDC via CDP faucet, with Circle fallback URL
  api/sessions/route.ts               x402-protected session creation: verify, createRoom, persist (M5: per-user wallet)
  api/sessions/[id]/status/route.ts   (M4) GET — current status — M5: ownership-gated
  api/sessions/[id]/transcript/route.ts (M4) POST — append a transcript line — M5: ownership-gated
  api/sessions/[id]/recap/route.ts    (M4) GET — streams Haiku summary — M5: ownership-gated
  api/sessions/[id]/chat/route.ts     (M4) POST — streams Haiku chat — M5: ownership-gated
  api/sessions/[id]/retry-settle/route.ts (M4.9) POST — manual retry from SETTLE_FAILED — M5: ownership-gated
  api/webhooks/daily/route.ts         Daily participant.{joined,left} + meeting.ended handler — HMAC, settle, mark COMPLETED
auth.ts                               (M5) NextAuth v5 factory — Cognito provider, JWT strategy, trustHost
next-auth.d.ts                        (M5) module augmentation — Session.user.id type
proxy.ts                              Next 16 edge proxy — wraps NextAuth auth() — gates /marketplace, /session/* (M5: NextAuth-backed)
amplify.yml                           (M5) AWS Amplify Hosting build spec — Node 22 + pnpm + .env.production forwarding
components/
  Navbar.tsx                          (M4.5) server — fetches user, hands to NavbarShell, self-skips on /session/<id>
  NavbarShell.tsx                     (M4.5) client — Aceternity floating navbar — M5: <NetworkBadge /> inline
  Footer.tsx                          (M4.5) three-column footer — self-skips on /session/* (call + recap)
  WalletPanel.tsx                     (M5) client — polls /api/users/me/balance, "Fund my wallet" button, faucet fallback
  ExpertCard.tsx                      (M4) marketplace card — redesigned in M4.5 (orange rate badge, hover lift, flex-1 footer)
  ExpertCardSubmitButton.tsx          (M4.5) client wrapper using useFormStatus for spinner during startSession
  SessionRoom.tsx                     (M4) Daily iframe + ticker + transcription + status polling — M4.5 redesigned JSX
  Ticker.tsx                          (M4) live $X.XX billing ticker, freezes on call end
  Recap.tsx                           (M4) recap UI — M4.5 redesigned JSX, backend identical (settle status card, M4.5 chat palette)
  ui/aurora-background.tsx            (M4.5) Aceternity — recolored to payphone palette, used on /marketplace + /session/<id>/recap
  ui/background-beams-with-collision.tsx (M4.5) Aceternity — recolored, used on landing hero
  ui/spotlight-new.tsx                (M4.5) Aceternity — recolored, used on /login
  ui/floating-navbar.tsx              (M4.5) Aceternity primitive — base for NavbarShell
  ui/                                 shadcn primitives (button, card, input, avatar, badge, …)
infra/terraform/                      AWS infra-as-code
  cognito.tf                          (M5) Cognito user pool, Hosted UI domain, web app client — callbacks for localhost + Amplify
  users-table.tf                      (M5) payphone-users DDB table (cognito_sub → CDP wallet mapping)
  dynamodb.tf                         (M3) payphone-sessions DDB table
  iam.tf                              runtime IAM user with DDB CRUD on both tables
  outputs.tf                          terraform output for env-var bootstrap (sensitive: client secret, app keys)
lib/
  constants.ts                        ALL chain/contract constants — M5: ACTIVE_NETWORK reads NEXT_PUBLIC_ACTIVE_NETWORK
  cdp.ts                              CDP client singleton + buyer/seller account accessors
  x402.ts                             facilitator client + retry-with-backoff settle
  daily.ts                            Daily REST + webhook HMAC + (M4) meeting tokens
  db.ts                               DynamoDB doc client + session CRUD — M5: APP_AWS_* aliases for Amplify, getDoc() exported
  agent.ts                            (M4) `requestSession` — M5: optional buyer override for CLI
  auth.ts                             (M5) NextAuth wrapper — getCurrentUser() returns AppUser from session
  user-wallet.ts                      (M5) getOrCreateUserWallet — lazy CDP wallet provisioning + DDB mapping
  session-auth.ts                     (M5) requireSessionOwner / requireSessionOwnerForPage — ownership guards
  seed.ts                             (M5) experts only (DEMO_USERS removed); displayRate harmonized to $0.60/min
  avatar.ts                           (M4) DiceBear hosted-CDN avatar URLs
  haiku.ts                            (M4) Anthropic Haiku via Vercel AI SDK — summarize + chat
  billing.ts                          (M4.9) active-window math — pure functions, idempotent + commutative
  utils.ts                            (M4) shadcn `cn` helper
scripts/                              diagnostic + admin scripts (see table above)
  migrate-achyut.ts                   (M5) one-time DDB row linking a Cognito sub → existing M0-funded wallet
```

## Scripts

```bash
pnpm dev            # next dev (Turbopack)
pnpm build          # next build
pnpm lint           # eslint
pnpm format         # prettier --write
pnpm format:check   # prettier --check (CI-friendly)
pnpm test           # (M4.9) tsx --test scripts/test-active-window.ts
```

The pre-commit drill is `pnpm lint && pnpm format && pnpm build && pnpm test` —
keep those green before pushing.

## Testing

Unit tests live in `scripts/test-active-window.ts` and run via Node 22+'s
built-in `node:test` runner under `tsx`. Zero new runtime deps. The tests
cover the active-window math in `lib/billing.ts` that drives both the
on-chain settle amount and the buyer's displayed ticker — if either
function drifts these tests catch it.

| #   | Test                                                                  | Verifies                                                                                                                      |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | empty events → window never opens                                     | An empty event log returns `{start_ms: undefined, end_ms: undefined}` and `activeWindowDurationSec → 0`.                      |
| 2   | single participant only → window never opens                          | One participant joining alone never opens the window — the buyer is not billed for waiting.                                   |
| 3   | two participants normal flow → opens at 2nd join, closes at 1st leave | The canonical case. The buyer's pre-expert wait time is **not** billed; only the time both were in the room counts.           |
| 4   | out-of-order events → identical result (delivery-order independence)  | Daily's webhooks are at-least-once and not strictly ordered — feeding events in reverse must produce the same window math.    |
| 5   | three participants → 1st pair opens, 1st leave below count-2 closes   | Window opens when count first reaches 2 (not 3); closes when count first drops below 2 (not when room fully empties).         |
| 6   | settle amount cap → duration × rate clamps at the upto MAX            | `computeSettleAmount(durationSec)` clamps at `M2_UPTO_MAX_ATOMIC` (\$5) regardless of duration. The signed permit caps spend. |
| 7   | idempotent under duplicate events (Daily at-least-once)               | Re-applying the same `joined` event twice is a no-op (Set-replay) — duplicates do not inflate the duration.                   |
| 8   | window opened but not closed → uses `nowMs` as running end            | Drives the live client ticker — the running duration uses the supplied `nowMs` while the window is still open.                |

Run them with:

```bash
pnpm test
```

All 8 tests should pass in ~100ms. CI-friendly exit codes (0 / non-zero).

The 9-scenario manual QA matrix from M4.9 is documented in the
[M4.9 proof](#m49-proof) section above. To rerun: `pnpm dev`, `ngrok`,
`pnpm tsx scripts/register-daily-webhook.ts <ngrok-url>/api/webhooks/daily`,
then drive scenarios 1-9 in the browser.
