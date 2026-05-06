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
| M4        | Marketplace UI + session page + recap page           | next              |
| M5        | Mainnet flip + on-stage live demo                    | pending           |

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

## Stack

- **Next.js 16** App Router, **TypeScript** strict
- **CDP Server Wallets v2** ("Agentic Wallets") + **CDP x402 Facilitator**
- **`@x402/core`, `@x402/evm`, `@x402/fetch`** (x402 protocol v2)
- **viem** for on-chain reads
- **Daily.co** for video rooms
- **AWS DynamoDB** for session state (Terraform-managed)
- **AWS Amplify Hosting** for production deploy (M5)
- **Tailwind v4** + **shadcn/ui** + **Lucide React** (M4+)
- **Anthropic Claude Haiku 4.5** for post-call recap (M4+)
- **pnpm**

## Architecture

```
                                ┌──────────────────┐
                                │  buyer-agent.ts  │
                                │  (CDP wallet)    │
                                └────────┬─────────┘
                                         │ POST /api/sessions
                                         │ (PAYMENT-SIGNATURE)
                                         ▼
        ┌─────────────────────────────────────────────────────────┐
        │              Next.js (Node runtime)                     │
        │                                                         │
        │  /api/sessions ──┬─► verify (CDP facilitator)           │
        │                  ├─► createRoom (Daily.co REST)         │
        │                  ├─► createSession (DynamoDB)           │
        │                  └─► return { sessionId, roomUrl }      │
        │                                                         │
        │  /api/webhooks/daily ◄── meeting.ended (HMAC-signed)    │
        │                  ├─► verifyWebhookSignature             │
        │                  ├─► getSessionByRoomId (DynamoDB)      │
        │                  ├─► settleWithRetry (CDP facilitator)  │
        │                  └─► markSessionCompleted (DynamoDB)    │
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
```

## Diagnostics

Living under `scripts/`:

| Script                      | What it does                                                              |
| --------------------------- | ------------------------------------------------------------------------- |
| `wallet-setup.ts`           | Resolves the buyer CDP wallet (idempotent)                                |
| `fund-check.ts`             | Reads buyer Sepolia USDC + ETH balance; `--top-up --target=N` faucet loop |
| `buyer-agent.ts`            | Drives the x402 round-trip end-to-end, prints `roomUrl` for M3            |
| `register-daily-webhook.ts` | Idempotent register/replace of the Daily `meeting.ended` webhook          |
| `inspect-session.ts`        | Reads a DDB session row by id; prints BaseScan URL when settled           |
| `probe-supported.ts`        | Lists the (scheme, network) pairs the CDP facilitator advertises          |
| `probe-usdc.ts`             | Reads `name`/`version`/`DOMAIN_SEPARATOR` etc. from USDC on-chain         |
| `verify-tx.ts`              | Inspects a tx receipt + decodes USDC `Transfer` events                    |

## Layout

```
app/
  api/sessions/route.ts          x402-protected session creation: verify, createRoom, persist
  api/webhooks/daily/route.ts    Daily meeting.ended handler: HMAC, settle, mark COMPLETED
infra/terraform/                 AWS infra-as-code (DDB table + scoped runtime IAM)
lib/
  constants.ts                   ALL chain/contract constants in ONE place
  cdp.ts                         CDP client singleton + buyer/seller account accessors
  x402.ts                        facilitator client + retry-with-backoff settle
  daily.ts                       Daily REST + webhook HMAC verification
  db.ts                          DynamoDB doc client + session CRUD
scripts/                         diagnostic + admin scripts (see table above)
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
