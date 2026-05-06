# PayPhone — Execution Prompt for Milestone 1

> Copy the entire file below this line into a new Claude Desktop chat with Desktop Commander enabled. That chat will then build Milestone 1.

---

You are Claude in a fresh chat with no prior history. Your job is to build **PayPhone** — an x402 paywall for time-metered video sessions — for the EasyA Consensus Miami 2026 hackathon (Agentic Track).

You have **Desktop Commander** tools (`start_process`, `write_file`, `read_file`, `edit_block`, `list_directory`, `interact_with_process`, `read_process_output`, `kill_process`).

## STEP 0 — Read the project context (MANDATORY, do this first)

Before any other action, read these files in this exact order using `read_file`:

1. `/Users/achyutkatiyar/payphone/docs/CONTEXT.md` — defines the entire project, behavior rules, file structure, and out-of-scope items
2. `/Users/achyutkatiyar/payphone/docs/PROGRESS.md` — what's already been done
3. `/Users/achyutkatiyar/payphone/docs/STRETCH_GOALS.md` — items you must NOT build

Reference `/Users/achyutkatiyar/payphone/docs/RESEARCH_DOSSIER.md` later when you need technical details on x402, CDP, or Daily.co — do NOT load it now to avoid bloating context.

After reading the three files above, confirm in chat that you've read them and understand:
- The project mission
- The locked stack
- The behavior rules (especially: never read `.env.local` contents, never auto-commit, run lint+format+build before considering changes done)
- What's out of scope

Then proceed to the milestone.

---

## YOUR TASK FOR THIS SESSION — Milestone 1

**Milestone 1: x402 round-trip on Base Sepolia using the `exact` scheme.**

Hardcoded $0.10 per request. NO `upto` yet (that's M2). NO Daily.co (M3). NO frontend (M4). Just prove the x402 plumbing end-to-end on Sepolia.

### Done criterion (testable)

A Node.js script `scripts/buyer-agent.ts` can:

1. Start the Next.js dev server with `pnpm dev`
2. Run the buyer-agent script in a separate terminal
3. The script POSTs to `http://localhost:3000/api/sessions`
4. Server returns HTTP 402 with `PaymentRequirements` (exact scheme, $0.10 USDC, Base Sepolia)
5. The `x402-fetch` wrapper auto-handles the 402, signs the EIP-712 with the CDP wallet, retries with `X-PAYMENT` header
6. Server calls CDP `/verify`, then CDP `/settle`
7. Server returns 200 with `{ sessionId: string, paymentTx: string }`
8. The tx hash is visible at `https://sepolia.basescan.org/tx/<hash>` and shows USDC moving from the buyer wallet

If you reach this state, M1 is done. Stop, append to PROGRESS.md, ask the user to verify, and DO NOT proceed to M2.

### Sequence of work

1. **Verify pre-flight state.** Use `list_directory` on `/Users/achyutkatiyar/payphone` to confirm: `.env.local`, `docs/`, `scripts/wallet-setup.ts` exist; `node_modules/`, `package.json`, `.gitignore` do NOT exist (they were intentionally cleaned). Confirm `scripts/wallet-setup.ts` is present.

2. **Scaffold Next.js 15.** From `/Users/achyutkatiyar/payphone`, run:
   ```
   pnpm create next-app@latest . --typescript --tailwind --eslint --app --no-import-alias --no-src-dir --use-pnpm
   ```
   The `.` means "scaffold into the current dir." It should not conflict with `.env.local`, `scripts/`, or `docs/` because Next does not create those.

3. **Install runtime deps.** After scaffold:
   ```
   pnpm add @coinbase/cdp-sdk @coinbase/x402 @x402/evm@2.9.0 @x402/next @x402/fetch viem dotenv bs58
   pnpm add @anthropic-ai/sdk @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
   pnpm add @daily-co/daily-js
   ```
   We add Daily/Anthropic/AWS deps now even though M1 doesn't use them — saves npm round trips.

4. **Install dev deps for strict tooling.** 
   ```
   pnpm add -D prettier eslint-config-prettier
   ```

5. **Configure strict TypeScript.** Edit `tsconfig.json`:
   - `"strict": true`
   - `"moduleResolution": "node16"` (CDP SDK requires this; if Next's default scaffold uses `"bundler"`, switch to `"node16"`)
   - `"noUncheckedIndexedAccess": true`

6. **Configure Prettier.** Create `.prettierrc`:
   ```json
   {
     "semi": true,
     "singleQuote": true,
     "trailingComma": "all",
     "printWidth": 100,
     "tabWidth": 2
   }
   ```
   Add to `package.json` `scripts`:
   - `"format": "prettier --write \"**/*.{ts,tsx,md,json}\""`
   - `"format:check": "prettier --check \"**/*.{ts,tsx,md,json}\""`

7. **Configure ESLint with Prettier.** Edit `eslint.config.mjs` (or `.eslintrc.json` depending on what scaffold created) so `prettier` is the LAST extends entry (disables conflicting rules). Keep `next/core-web-vitals` and `next/typescript`.

8. **Update `.gitignore`** to ensure `.env.local` and `.env*.local` are ignored (Next default already includes this; verify).

9. **Create `lib/constants.ts`** with all chain/contract constants from `RESEARCH_DOSSIER.md` section 3:
   ```ts
   export const USDC_ADDRESS = {
     mainnet: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
     sepolia: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
   } as const;
   export const USDC_DOMAIN = { name: 'USD Coin', version: '2' } as const;
   export const CHAIN_ID = { mainnet: 8453, sepolia: 84532 } as const;
   export const CAIP2 = { mainnet: 'eip155:8453', sepolia: 'eip155:84532' } as const;
   export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;
   export const X402_PROXY = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001' as const;
   export const FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402' as const;
   // M1 uses Sepolia; flip this for M5 mainnet migration
   export const ACTIVE_NETWORK = 'sepolia' as const;
   export const ACTIVE_CHAIN_ID = CHAIN_ID[ACTIVE_NETWORK];
   ```

10. **Create `lib/cdp.ts`** as a CDP client singleton (see RESEARCH_DOSSIER.md section 4).

11. **Implement `app/api/sessions/route.ts`.** This is the main x402 protected endpoint. Use the hand-rolled approach from RESEARCH_DOSSIER.md section 2:
    - On request without `X-PAYMENT`: return HTTP 402 with PaymentRequirements (`exact` scheme, $0.10 USDC, Sepolia)
    - On request with `X-PAYMENT`: call CDP `/verify` to validate; if valid, call CDP `/settle` with the same amount; return `{ sessionId: <uuid>, paymentTx: <tx-hash> }` on success
    - If `/verify` fails: return HTTP 402 with reason
    - If `/settle` fails: implement retry-with-backoff (3 attempts: 2s, 5s, 10s) per RESEARCH_DOSSIER.md section 2 mitigation
    - Export `runtime = 'nodejs'` at top of file

12. **Implement `scripts/buyer-agent.ts`** using the template from RESEARCH_DOSSIER.md section 9.

13. **Configure Tailwind colors.** Edit `tailwind.config.ts` to add `theme.extend.colors` with the named tokens from CONTEXT.md (`payphone-blue`, `payphone-bg`, etc.). M1 doesn't use them yet but configure now.

14. **Run end-to-end:**
    - Terminal 1: `pnpm dev`
    - Terminal 2: `pnpm tsx scripts/buyer-agent.ts`
    - Confirm 200 response with `paymentTx` field
    - Open `https://sepolia.basescan.org/tx/<paymentTx>` in browser, screenshot link to `docs/m1-tx.txt` (paste the URL, do not screenshot to a binary)

15. **Run lint + format + build:**
    - `pnpm format`
    - `pnpm lint`
    - `pnpm build`
    - All three must pass

16. **Append to PROGRESS.md.** Add a new `## M1 — ...` section using the format defined in PROGRESS.md. Include:
    - Files created (paths)
    - Tests run (the actual command and what it returned)
    - The tx hash and BaseScan URL
    - Anything broken or deferred
    - Next: M2 brief

17. **Stop and ask the user before committing.** Show the user a `git status` summary and propose a commit message like `feat: M1 - x402 sepolia round-trip with exact scheme`. Wait for explicit "yes commit" before running `git commit`.

### Stop conditions

- If `pnpm create next-app` fails because of conflicts in the directory, stop and ask the user.
- If you hit the "unable to estimate gas" issue on Sepolia (unlikely, this is a mainnet issue), retry once and then ask the user.
- If lint/format/build fail and you can't resolve in 15 minutes, append details to `docs/BLOCKED.md` and ask the user.
- After M1 done criterion is satisfied, STOP. Do not begin M2.

### Tools and constraints

- Use Desktop Commander, never bash on Claude's container (network is disabled there).
- All file writes go through `write_file` (Desktop Commander), never `create_file` (which writes to the wrong filesystem).
- Use `pnpm`, not npm.
- Never read `.env.local` contents. The CDP SDK reads env vars through `process.env` at runtime; you don't need to know what's in the file.
- After every significant change, run lint + format + build. If they pass, ask user before committing.
- If you find yourself reaching for any of the items in `STRETCH_GOALS.md`, stop. Those are out of scope for M1.

### Begin

Start by reading the three docs files. Confirm understanding. Then proceed to step 1 of the sequence.
