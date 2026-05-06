# PayPhone — Research Dossier (Technical Reference)

> Use as a reference when implementing. CONTEXT.md is your primary doc; this is what to consult for technical specifics.

## 1. The `upto` scheme on EVM

### Spec essentials

- **Single-Use Authorization**: each payload settles at most once (Permit2 nonce enforces).
- **Time-Bound**: `validAfter` (start) and `deadline` (end) required.
- **Recipient Binding**: server cannot redirect funds (Permit2 `witness.to` binds).
- **Maximum Amount Enforcement**: settled amount ≤ authorized maximum. May be `0`.
- **Phase-dependent `amount`**: at verify time, `PaymentRequirements.amount` = MAX. At settle time, same struct, but `amount` = ACTUAL ≤ MAX.

### What happens to the unspent allowance?

Nothing on-chain. The Permit2 authorization is consumed by the single `/settle` call which moves only the settled amount. Remainder simply expires when `deadline` passes. No refund tx needed because no funds were ever transferred.

### Package and version

- Package: `@x402/evm` v2.9.0
- Class: `UptoEvmScheme` (NOT `UptoEvmClient` — common rename)
- Import path (verify in node_modules at install time): typically `@x402/evm/upto/client`

### Authorization flow on EVM (Permit2 witness)

1. Buyer signs `PermitWitnessTransferFrom` with `witness = { to: payTo, validAfter, extra }`
2. `spender` in the signature is the canonical `x402ExactPermit2Proxy` at `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` (same address on every EVM chain via CREATE2)
3. The Proxy enforces that funds only flow to `witness.to`, blocking facilitator misbehavior

### `upto` requires Permit2, not EIP-3009

`upto` is implemented via Permit2 + the `x402ExactPermit2Proxy` witness pattern because EIP-3009's `transferWithAuthorization` transfers a fixed signed amount and cannot be underspent. **First-time `approve(Permit2)` on USDC is required.** Use the gas-sponsorship extension so the facilitator pays.

```ts
// In your seller's PaymentRequirements
extensions: { ...declareErc20ApprovalGasSponsoringExtension() }
```

## 2. CDP Facilitator on Base mainnet

### Endpoints

- Base URL: `https://api.cdp.coinbase.com/platform/v2/x402`
- `POST /verify` — verify payload + requirements (~100ms, no chain interaction)
- `POST /settle` — submit on-chain tx, wait for confirmation (~2s when healthy)
- `GET /supported` — list supported (scheme, network) pairs

### Pricing

1,000 transactions/month free, then $0.001 per tx. **Gas on Base is paid by the facilitator** for both `exact` and `upto` schemes.

### Authentication: Ed25519 JWT, generated per-request

The `@coinbase/x402` package's exported `facilitator` handles this for you — recommended path. Hand-rolling JWT is only needed for non-standard flows.

### `/verify` request body

```json
{
  "x402Version": 2,
  "paymentRequirements": { /* with amount = MAX */ },
  "paymentPayload":      { /* signed payload */ }
}
```

### `/verify` response

```json
{ "isValid": true, "invalidReason": null, "payer": "0x..." }
```

### `/settle` request body — `amount` is ACTUAL, not MAX

```json
{
  "x402Version": 2,
  "paymentRequirements": { /* same shape, amount = ACTUAL ≤ MAX */ },
  "paymentPayload":      { /* same signed payload as verify */ }
}
```

### `/settle` success response

```json
{ "success": true, "transaction": "0xabc...", "network": "base", "payer": "0x..." }
```

### `/settle` failure response (the "unable to estimate gas" issue)

```json
{
  "success": false,
  "errorMessage": "failed to send transaction: error (status 400): invalid_request: unable to estimate gas",
  "errorReason": "invalid_payload",
  "network": "base",
  "payer": "0x..."
}
```

### Issue #1065 mitigation (mandatory for mainnet)

Open issue in `coinbase/x402` repo. ~40% failure rate on mainnet `/settle` with valid signatures. Root cause uninvestigated by Coinbase as of research date.

**Required mitigations:**

1. Wrap `/settle` in retry-with-exponential-backoff: 3 attempts at 2s, 5s, 10s.
2. Pre-warm the buyer wallet 60 seconds before stage demo with one tiny dry-run settle.
3. Keep a Sepolia fallback ready for hot swap.
4. Build a fallback path using EIP-3009 `exact` scheme (set `USE_EXACT_FALLBACK=true`) if upto fails twice in a row on stage.
5. **Do not use `idempotencyKey` for retries** — the issue thread suggests this masks the bug rather than fixing it.

## 3. Base mainnet specifics

| Item | Value |
|------|-------|
| USDC mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDC Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| EIP-712 domain `name` (USDC) | `"USD Coin"` (two words, capital C) |
| EIP-712 domain `version` (USDC) | `"2"` |
| chainId mainnet | `8453` |
| chainId Sepolia | `84532` |
| CAIP-2 mainnet | `eip155:8453` |
| CAIP-2 Sepolia | `eip155:84532` |
| Block time | ~2 seconds, single-slot finality |
| Permit2 canonical address | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| `x402ExactPermit2Proxy` | `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` |
| Facilitator base URL | `https://api.cdp.coinbase.com/platform/v2/x402` |

Hardcode all of these in `lib/constants.ts`.

## 4. CDP SDK usage

### Install

```bash
pnpm add @coinbase/cdp-sdk dotenv
pnpm add -D bs58  # transitive dep that doesn't always install
```

### Init

```ts
import { CdpClient } from '@coinbase/cdp-sdk';
import 'dotenv/config';

const cdp = new CdpClient(); // reads CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET from env
```

### Get or create the buyer wallet (idempotent)

```ts
const account = await cdp.evm.getOrCreateAccount({ name: 'payphone-buyer' });
```

This returns the same address across runs, including the existing `0xE01669A01E28E905055Ac6cD33c19ced7e10d870`.

### Sign EIP-712 typed data

```ts
const sig = await cdp.evm.signTypedData({
  address: account.address,
  domain: { name, chainId, verifyingContract },
  types: { /* ... */ },
  primaryType: 'PermitWitnessTransferFrom',
  message: { /* ... */ },
});
```

Returns a viem-compatible signature object.

### Adapter to viem-style account

Use `viem/accounts.toAccount()` with a custom `signTypedData` that calls `cdp.evm.signTypedData`. Pass the resulting account to `@x402/evm`'s `UptoEvmScheme` constructor.

## 5. Daily.co specifics

### Room creation

```http
POST https://api.daily.co/v1/rooms
Authorization: Bearer $DAILY_API_KEY
Content-Type: application/json

{
  "properties": {
    "exp": <unix seconds — now + 30 min max>,
    "nbf": <unix seconds>,
    "eject_at_room_exp": true,
    "max_participants": 2,
    "enable_prejoin_ui": false,
    "enable_chat": false,
    "enable_recording": null,
    "enable_transcription": true
  }
}
```

Response includes `url` (e.g., `https://payphone.daily.co/<room-name>`).

### Realtime transcription

- Started programmatically via `room.startTranscription()` (client-side) or via REST
- Provider: Deepgram under the hood (auto)
- Pricing: $0.0059 per unmuted participant-minute
- **Stop transcription on `participant.left` (last)** to prevent runaway billing

### Webhooks

- Register: `POST https://api.daily.co/v1/webhooks` with target URL
- Events to subscribe: `meeting.started`, `meeting.ended`, `participant.joined`, `participant.left`, `transcription.message`, `transcription.stopped`
- `meeting.ended` fires up to ~20 seconds after last participant leaves
- Retries: exponential backoff up to 5×, max 15 minutes total
- 5-second endpoint timeout
- HMAC signature verification: include header `x-webhook-signature` check against your registered webhook's secret

### `meeting.ended` payload

Contains `participants` array. Each participant has `join_time`, `duration` (seconds, ~15s granularity). Bill on the longest non-host participant duration.

### Embed in Next.js (client-only)

```tsx
'use client';
import { useEffect, useRef } from 'react';
import DailyIframe, { DailyCall } from '@daily-co/daily-js';

export default function VideoFrame({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  useEffect(() => {
    if (!ref.current || callRef.current) return;
    callRef.current = DailyIframe.createFrame(ref.current, {
      iframeStyle: { width: '100%', height: '600px', border: '0' },
      showLeaveButton: true,
    });
    callRef.current.join({ url });
    return () => { callRef.current?.destroy(); };
  }, [url]);
  return <div ref={ref} />;
}
```

## 6. DynamoDB schema

Table: `payphone-sessions`
Billing: `PAY_PER_REQUEST`

| Attribute | Type | Notes |
|---|---|---|
| `session_id` | String (PK) | UUID v4 |
| `user_id` | String | seeded user id (e.g., `seed-alice`) |
| `expert_id` | String | seeded expert id |
| `agent_wallet_addr` | String | from CDP wallet |
| `payment_authorization_payload` | String (JSON) | signed Permit2 witness, base64 of x402 PaymentPayload |
| `video_room_id` | String | Daily room id |
| `video_room_url` | String | Daily room URL |
| `started_at` | Number | unix seconds |
| `ended_at` | Number? | set on webhook |
| `duration_sec` | Number? | set on webhook |
| `max_authorized_amount` | Number | atomic units (USDC base 1e6) |
| `settled_amount` | Number? | atomic units |
| `settle_tx_hash` | String? | base mainnet tx hash |
| `transcript` | String? | full transcript captured during call |
| `summary` | String? | AI-generated recap |
| `status` | String | `AUTHORIZED` \| `ACTIVE` \| `COMPLETED` \| `SETTLE_FAILED` |
| `expires_at` | Number | TTL attribute, `started_at + 86400` |

No GSI needed at hackathon scale.

## 7. Edge cases to handle (pick the high-likelihood ones first)

1. **Authorization deadline expires mid-call** — set `deadline = nbf + 30 min`, cap session at 15 min.
2. **`/settle` "unable to estimate gas"** — retry 3x with backoff (CRITICAL).
3. **`meeting.ended` webhook never arrives** — background poll: `GET /v1/meetings?room=...`. After 60s without webhook, fall back to poll.
4. **Decimal precision drift** — bill in atomic units (USDC base 1e6) all the way through, format only at render.
5. **Wrong EIP-712 domain** — hardcode `"USD Coin"` and `"2"` in `lib/constants.ts`. Unit test the domain hash.
6. **Settle succeeds, server crashes before persisting tx hash** — idempotent settle (same payload returns same on-chain tx). On restart, look up from DDB and re-call CDP if needed.

## 8. Optimal API runtime

```ts
// Top of every API route file that uses CDP SDK or x402
export const runtime = 'nodejs'; // CDP SDK is NOT Edge-compatible
```

## 9. The buyer agent (M1 reference)

```ts
// scripts/buyer-agent.ts (M1: hardcoded $0.10 exact scheme)
import { CdpClient } from '@coinbase/cdp-sdk';
import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toAccount } from 'viem/accounts';
import 'dotenv/config';

const SERVER = process.env.SERVER_URL ?? 'http://localhost:3000';

async function main() {
  const cdp = new CdpClient();
  const account = await cdp.evm.getOrCreateAccount({ name: 'payphone-buyer' });

  const viemAcct = toAccount({
    address: account.address as `0x${string}`,
    async signTypedData({ domain, types, primaryType, message }) {
      const r = await cdp.evm.signTypedData({
        address: account.address, domain, types, primaryType, message,
      });
      return r.signature as `0x${string}`;
    },
    async signMessage() { throw new Error('not supported'); },
    async signTransaction() { throw new Error('not supported'); },
  });

  const client = new x402Client();
  client.register('eip155:84532', new ExactEvmScheme(viemAcct)); // M1: Sepolia
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const res = await fetchWithPayment(`${SERVER}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: 'M1 test' }),
  });
  if (!res.ok) throw new Error(`Failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  console.log('OK', body);
}
main().catch(e => { console.error(e); process.exit(1); });
```

For M2 swap `ExactEvmScheme` → `UptoEvmScheme` and switch `eip155:84532` → `eip155:8453` for mainnet.

## 10. Anthropic SDK for the recap LLM

```ts
// lib/haiku.ts
import Anthropic from '@anthropic-ai/sdk';

const a = new Anthropic();
export async function summarize(transcript: string, topic: string) {
  const res = await a.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    system: `You are PayPhone's session summarizer. Produce a concise minutes-of-meeting style summary with: Topic, Key points (3-5 bullets), Action items, Open questions. Use markdown.`,
    messages: [{ role: 'user', content: `Topic: ${topic}\n\nTranscript:\n${transcript}` }],
  });
  return res.content[0].type === 'text' ? res.content[0].text : '';
}
```
