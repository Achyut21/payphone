# PayPhone — Project Context

> Read this file completely on every session start. It defines the project.

## What this is

PayPhone is an x402 paywall for time-metered video sessions with human experts. Built for **EasyA Consensus Miami 2026 (Agentic Track, Coinbase + AWS sponsored)**. Demo on stage Thursday, May 7.

A buyer-side AI agent autonomously authorizes "up to $X" via x402's `upto` scheme, opens a Daily.co video room with a human expert, and settles for the actual call duration in one on-chain Permit2 transfer of USDC on Base mainnet.

## The pitch (do not drift from these three lines)

1. **"Stripe physically can't do this."** Stripe minimum 30¢ + 2.9% means per-second billing is impossible.
2. **"x402 + upto turns per-second billing into one on-chain settlement."** One signature authorizes up-to, one tx settles actual usage.
3. **"The video call is the demo — the rail is the product."** The demo is a video call; the innovation is the payment infrastructure.

## Locked stack (do not propose alternatives)

- **Next.js 15** App Router, TypeScript everywhere, strict mode
- **AWS Amplify Hosting** (primary) — Vercel as fallback only if Amplify fails
- **AWS DynamoDB** for session state (single-table, on-demand billing)
- **AWS Lambda** for the Daily.co webhook receiver
- **CDP Server Wallets v2** ("Agentic Wallets") for the buyer side
- **CDP x402 Facilitator** for `/verify` and `/settle`
- **Daily.co** for video rooms (free tier + paid realtime transcription, ~$3 total)
- **Base mainnet** for production demo, **Base Sepolia** for development
- **USDC on Base**, **x402 `upto` scheme via Permit2**
- **Anthropic Claude Haiku 4.5** (model id: `claude-haiku-4-5`) for buyer-agent and recap LLM calls
- **Tailwind CSS v4** + **shadcn/ui** + **Lucide React**
- **pnpm** as package manager

## What exists right now (do not recreate)

- CDP buyer wallet at `0xE01669A01E28E905055Ac6cD33c19ced7e10d870`
- $5 USDC funded on Base mainnet (verified on BaseScan)
- `.env.local` at project root contains: `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, `DAILY_API_KEY`
- User will add `ANTHROPIC_API_KEY` when needed (~M4 onward)
- Daily.co domain: `payphone.daily.co`
- `scripts/wallet-setup.ts` — verified working; reproduces the buyer wallet from CDP env vars

## Key technical decisions and why

- **Hand-roll x402 verify+settle** (do NOT use `paymentMiddleware`/`withX402` for the `/sessions` route) because settlement must wait until call hangup, not request time
- **`upto` scheme** (not `exact`) because per-second billing is the entire pitch
- **Single settlement at hangup** using actual duration; the unspent allowance simply expires on-chain
- **Daily realtime transcription** is paid (~$0.0059/participant-min, ~$3 total) and powers the recap page
- **Auth is fake** — three seeded user buttons, no Cognito, no real auth provider
- **Marketplace UI is seeded** — 3-5 expert cards with hardcoded data, no admin panel

## Known risks (carry these in mind throughout the build)

- **coinbase/x402 issue #1065**: mainnet `/settle` returns "unable to estimate gas" ~40% of attempts. **Mitigation:** wrap settle in retry-with-backoff (3 attempts: 2s, 5s, 10s). Pre-warm wallet with one tiny dry-run before stage demo.
- **Permit2 first-time approval** is required for `upto` scheme on Base mainnet. **Mitigation:** declare `erc20ApprovalGasSponsoring` extension in PaymentRequirements so the facilitator pays gas. Do approval during dress rehearsal #1.
- **Daily transcription requires a CC on file** ($15 credit covers our usage entirely; never enable cloud recording or live streaming).
- **EIP-712 domain for USDC** is `"USD Coin"` (two words, capital C), version `"2"`. Hardcode in `lib/constants.ts`.

## File structure (use this exactly)

```
payphone/
  app/
    (marketplace)/page.tsx          Expert marketplace (landing)
    session/[id]/page.tsx           Video call page with live ticker
    session/[id]/recap/page.tsx     Post-call summary + follow-up chat
    api/
      sessions/route.ts             x402-protected session creation
      webhooks/daily/route.ts       Daily meeting.ended webhook
      recap/[id]/route.ts           Returns summary; chat endpoint
  lib/
    cdp.ts                          CDP client singleton
    x402.ts                         x402 verify/settle helpers (with retry)
    daily.ts                        Daily REST client + webhook signature verify
    db.ts                           DynamoDB doc client
    constants.ts                    ALL chain/contract constants in ONE place
    haiku.ts                        Anthropic SDK helper
    seed.ts                         Seeded experts and demo users
  components/
    ui/                             shadcn/ui components
    ExpertCard.tsx
    Ticker.tsx
    SettleStatus.tsx
    LoginButtons.tsx
  scripts/
    wallet-setup.ts                 (existing) reproduces buyer wallet
    fund-check.ts                   (you'll create) verifies USDC balance
    buyer-agent.ts                  (you'll create) M1 buyer-agent script
  docs/
    CONTEXT.md                      (this file — read every session)
    PROGRESS.md                     (rolling progress log; append each milestone)
    STRETCH_GOALS.md                (do NOT build; reference only)
    RESEARCH_DOSSIER.md             (deep technical reference)
  .env.local                        (DO NOT read or paste contents)
  .gitignore                        (Next.js scaffold creates one)
  package.json
  tsconfig.json
  tailwind.config.ts                (define ALL colors here, ONCE)
  next.config.ts
  .prettierrc
  eslint.config.mjs
```

## Behavior rules (mandatory)

### File and secret hygiene

- All files go under `/Users/achyutkatiyar/payphone`. Never write outside this directory.
- **NEVER read `.env.local` contents.** Env vars come through `process.env` at runtime.
- **NEVER paste any secret value into chat output, even partial, even if asked.**
- `.env.local` must be in `.gitignore` from commit zero.

### Linting, formatting, building

- ESLint with `next/core-web-vitals` and `next/typescript` configs, strict.
- Prettier integrated via `eslint-config-prettier`.
- `pnpm` scripts: `lint`, `format`, `format:check`, `build`, `dev`.
- After EVERY significant change run `pnpm lint && pnpm format && pnpm build` before considering the change complete.
- **NEVER auto-commit.** After lint+format+build pass, ASK the user before running `git commit`.

### Git

- Commits use conventional format: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`.
- Short messages, one-line subject. Body only when context is essential.
- **Never** `git push --force`, **never** amend pushed commits, **never** `git reset --hard` without asking.

### TypeScript

- `strict: true` in tsconfig. No `any` without a comment justification.
- `moduleResolution: "node16"` (CDP SDK requires this).
- All API routes export `runtime = 'nodejs'` (Edge runtime breaks CDP SDK).
- Use `type` aliases for object shapes; `interface` only when extension is needed.

### Tailwind / styling

- Define ALL colors in `tailwind.config.ts` `theme.extend.colors` ONCE.
- Use named tokens like `payphone-blue`, `payphone-bg`, `payphone-ink`. NEVER inline hex codes like `bg-[#0052FF]` in components.
- Color tokens to define:
  - `payphone-blue: '#0052FF'` (Base brand blue, primary accent)
  - `payphone-bg: '#FAFAFA'` (near-white background)
  - `payphone-surface: '#FFFFFF'` (card surface)
  - `payphone-ink: '#0A0A0A'` (primary text)
  - `payphone-muted: '#71717A'` (secondary text, zinc-500)
  - `payphone-success: '#10B981'` (settled state, emerald-500)
  - `payphone-border: '#E4E4E7'` (zinc-200)
- Use shadcn/ui as the component baseline; do not write Card/Button/Input from scratch.
- Light mode primary. No dark mode toggle for the hackathon.

### Daily.co safety rails

- **NEVER** enable `cloud recording` (billable, no free tier).
- **NEVER** enable live streaming or telephony.
- All rooms must set `exp` to (now + 30 minutes max) and `eject_at_room_exp: true`.
- All rooms must set `max_participants: 2`.
- Stop transcription explicitly when last participant leaves.

### Stop and ask

- If blocked >15 minutes on the same error, stop. Append the error and what you tried to `docs/BLOCKED.md`. Ask the user.
- If a decision changes the architecture (swapping a library, changing the schema, etc.), stop and ask the user before doing it.
- After each milestone, append to `docs/PROGRESS.md` and stop for user review.

### Out of scope (do NOT build unless user explicitly asks)

- AWS Cognito real auth (we use seeded fake login)
- Real expert profiles / admin panel (seed data only)
- Cloud recording on Daily (transcription only)
- Persona chat trained on transcript (only RAG-lite over transcript)
- LLM-decides-which-expert flow (user picks; LLM only summarizes post-call)
- Multi-step "agent tries first then escalates" pattern
- Anything in `docs/STRETCH_GOALS.md`

## When you have technical questions

1. Check `docs/RESEARCH_DOSSIER.md` first — it has detailed answers on x402, CDP facilitator, Permit2, Daily.co, AWS architecture, edge cases, and pricing.
2. If the dossier doesn't cover it, web search.
3. Never invent API shapes. If unsure, look up the actual SDK or REST docs.

## Final reminder

The biggest single thing that determines whether this project succeeds is whether the on-stage mainnet demo settles a real USDC transfer with a BaseScan tx hash visible. Every architectural choice should serve that goal. Polish is secondary.
