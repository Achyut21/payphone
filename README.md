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

| Milestone | What it proves                                       | Status            |
| --------- | ---------------------------------------------------- | ----------------- |
| **M0**    | CDP wallet + USDC funding pre-flight                 | ✅ done (May 5–6) |
| **M1**    | x402 round-trip on Base **Sepolia**, exact scheme    | ✅ done (May 6)   |
| **M2**    | Swap `exact` → `upto` (Permit2 witness) on Sepolia   | ✅ done (May 6)   |
| **M3**    | Daily.co video rooms + DDB + duration-derived settle | ✅ done (May 6)   |
| **M4**    | Marketplace UI + live session + AI recap & chat      | ✅ done (May 6)   |
| M5        | Mainnet flip + on-stage live demo                    | next              |

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
- **End-to-end flow (browser):**
  1. `GET /` → edge `proxy.ts` checks cookie → if missing, 302 to `/login`
  2. `/login` server-action sets the cookie, redirects to `/` with the seeded
     four-expert marketplace
  3. Click "Talk to ..." → `<form action={startSession}>` runs the server
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

### M4: full browser flow (marketplace → live call → recap + chat)

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

1. **Login** — pick one of the four seeded users (Alice / Bob / Charlie / Diana).
   Cookie auth, no password (the seeded users aren't a security boundary —
   they're a demo aid).
2. **Marketplace** — four seeded experts (Solidity, Rust, UX, DevOps). Click
   **Talk to ...** on any card.
3. **Live session** — Daily iframe loads, ticker counts up at $0.01/sec in
   payphone-blue. Open the same `/session/<id>` URL in a second tab/browser
   to act as the expert. Talk for ~30–60 seconds. The transcript is captured
   in real time and POSTed to the server.
4. Click **Leave call** in the side panel — the ticker freezes immediately at
   the displayed value (which is what the on-chain settle will use).
5. **Auto-redirect to recap** — within ~5–15s the webhook fires, settle
   completes, and the page navigates to `/session/<id>/recap`. The Haiku
   summary streams in (Topic / Key points / Action items / Open questions),
   followed by a chat box where you can ask follow-up questions about the
   call (every answer is grounded in the captured transcript).
6. **BaseScan link** in the recap header takes you to the on-chain settle.

Inspect any session you've created from the browser:

```bash
pnpm tsx scripts/inspect-session.ts <sessionId> --transcript
```

`<sessionId>` shows in the URL bar of `/session/<id>` and `/session/<id>/recap`.

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

## Layout

```
app/
  page.tsx                            (M4) marketplace landing for logged-in users
  layout.tsx                          root layout, metadata, fonts
  globals.css                         Tailwind v4 @theme + payphone tokens + typography plugin
  login/page.tsx                      (M4) seeded-user login (server action)
  _actions/session.ts                 (M4) startSession server action — kicks off /api/sessions
  session/[id]/page.tsx               (M4) live session page (mints meeting token, renders SessionRoom)
  session/[id]/recap/page.tsx         (M4) post-call recap page (fetches DDB row, renders Recap)
  api/sessions/route.ts               x402-protected session creation: verify, createRoom, persist
  api/sessions/[id]/status/route.ts   (M4) GET — current status, used by client polling
  api/sessions/[id]/transcript/route.ts (M4) POST — append a transcript line to DDB
  api/sessions/[id]/recap/route.ts    (M4) GET — streams Haiku-generated markdown summary
  api/sessions/[id]/chat/route.ts     (M4) POST — streams Haiku follow-up chat answers
  api/webhooks/daily/route.ts         Daily meeting.ended handler: HMAC, settle, mark COMPLETED
proxy.ts                              (M4) Next 16 edge proxy — cookie auth gate for /, /session/*
components/
  ExpertCard.tsx                      (M4) marketplace card with avatar + Lucide icon + "Talk to" form
  SessionRoom.tsx                     (M4) Daily iframe + ticker + transcription + status polling
  Ticker.tsx                          (M4) live $X.XX billing ticker, freezes on call end
  Recap.tsx                           (M4) recap UI with streamed summary + useChat follow-up
  ui/                                 shadcn primitives (button, card, input, avatar, badge, …)
infra/terraform/                      AWS infra-as-code (DDB table + scoped runtime IAM)
lib/
  constants.ts                        ALL chain/contract constants in ONE place
  cdp.ts                              CDP client singleton + buyer/seller account accessors
  x402.ts                             facilitator client + retry-with-backoff settle
  daily.ts                            Daily REST + webhook HMAC + (M4) meeting tokens
  db.ts                               DynamoDB doc client + session CRUD + (M4) appendTranscript
  agent.ts                            (M4) `requestSession` — shared by CLI + server action
  auth.ts                             (M4) cookie helpers (getCurrentUser / setCurrentUser)
  seed.ts                             (M4) demo users + experts
  avatar.ts                           (M4) DiceBear hosted-CDN avatar URLs
  haiku.ts                            (M4) Anthropic Haiku via Vercel AI SDK — summarize + chat
  utils.ts                            (M4) shadcn `cn` helper
scripts/                              diagnostic + admin scripts (see table above)
```

## Scripts

```bash
pnpm dev            # next dev (Turbopack)
pnpm build          # next build
pnpm lint           # eslint
pnpm format         # prettier --write
pnpm format:check   # prettier --check (CI-friendly)
```

The pre-commit drill is `pnpm lint && pnpm format && pnpm build` — keep those
green before pushing.
