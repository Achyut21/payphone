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

| Milestone | What it proves                                    | Status                    |
| --------- | ------------------------------------------------- | ------------------------- |
| **M0**    | CDP wallet + USDC funding pre-flight              | ✅ done (May 5–6)         |
| **M1**    | x402 round-trip on Base **Sepolia**, exact scheme | ✅ done (May 6)           |
| M2        | Swap `exact` → `upto` (Permit2 witness) on Sepolia| next                      |
| M3        | Daily.co video rooms + meeting.ended webhook      | pending                   |
| M4        | Marketplace UI + session page + recap page        | pending                   |
| M5        | Mainnet flip + on-stage live demo                 | pending                   |

### M1 proof

First successful PayPhone session, $0.10 USDC, Base Sepolia:

- **Tx:** `0xc09fa4bf006b1937b7efc66e54725e02b55c992ac9bb9cd9f99d2492817c47bc`
- **BaseScan:** <https://sepolia.basescan.org/tx/0xc09fa4bf006b1937b7efc66e54725e02b55c992ac9bb9cd9f99d2492817c47bc>
- **What happened on-chain:** $0.10 USDC moved from the buyer wallet
  `0xE01669A01E28E905055Ac6cD33c19ced7e10d870` to the seller wallet
  `0x5c15772fd9132F2EaaCe0c55638fB674b0BaFC71`. Gas paid by the CDP facilitator
  (`0x68a96f41ff1e9f2e7b591a931a4ad224e7c07863`).

## Stack

- **Next.js 16** App Router, **TypeScript** strict
- **CDP Server Wallets v2** ("Agentic Wallets") + **CDP x402 Facilitator**
- **`@x402/core`, `@x402/evm`, `@x402/fetch`** (x402 protocol v2)
- **viem** for on-chain reads
- **Daily.co** for video rooms (M3+)
- **AWS DynamoDB + Lambda** for session state and webhooks (M3+)
- **AWS Amplify Hosting** for production
- **Tailwind v4** + **shadcn/ui** + **Lucide React** (M4+)
- **Anthropic Claude Haiku 4.5** for post-call recap (M4+)
- **pnpm**

## Quick start

You'll need:

- Node 24 (we use nvm)
- pnpm 10 (`corepack enable pnpm`)
- A `.env.local` at the project root containing:
  - `CDP_API_KEY_ID`
  - `CDP_API_KEY_SECRET`
  - `CDP_WALLET_SECRET`
  - `DAILY_API_KEY` (M3+)
  - `ANTHROPIC_API_KEY` (M4+)

```bash
pnpm install

# 1. Resolve the buyer wallet (idempotent — same address every run)
pnpm tsx scripts/wallet-setup.ts

# 2. Top up Sepolia USDC if needed (uses CDP faucet)
pnpm tsx scripts/fund-check.ts            # check
pnpm tsx scripts/fund-check.ts --top-up   # request faucet

# 3. Start the server
pnpm dev

# 4. In another terminal, drive the round-trip
pnpm tsx scripts/buyer-agent.ts
```

If everything is wired correctly you'll see `HTTP 200 OK` with a `paymentTx`
hash. Open it on BaseScan to see the on-chain transfer.

## Diagnostics

Living under `scripts/`:

| Script               | What it does                                                     |
| -------------------- | ---------------------------------------------------------------- |
| `wallet-setup.ts`    | Resolves the buyer CDP wallet (idempotent)                       |
| `fund-check.ts`      | Reads buyer Sepolia USDC + ETH balance; `--top-up` for faucet    |
| `buyer-agent.ts`     | Drives the x402 round-trip end-to-end                            |
| `probe-supported.ts` | Lists the (scheme, network) pairs the CDP facilitator advertises |
| `probe-usdc.ts`      | Reads `name`/`version`/`DOMAIN_SEPARATOR` etc. from USDC on-chain |
| `verify-tx.ts`       | Inspects a tx receipt + decodes USDC `Transfer` events           |

## Layout

```
app/
  api/sessions/route.ts   x402-protected session creation (hand-rolled 402→verify→settle)
lib/
  constants.ts            ALL chain/contract constants in ONE place
  cdp.ts                  CDP client singleton + buyer/seller account accessors
  x402.ts                 facilitator client + retry-with-backoff settle
scripts/                  diagnostic + admin scripts (see table above)
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
