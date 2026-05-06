/**
 * PayPhone — public technical documentation page (M4.5).
 *
 * Lives at `/docs`, public route (the proxy doesn't gate it). Server
 * Component, no client JS — the architecture diagram is hand-rolled SVG
 * with `max-w + overflow-x-auto` for mobile, and the rest is plain
 * markup.
 *
 * Background: solid `payphone-bg` with a subtle CSS-only dotted grid
 * (radial gradient repeated). No animated bg per the locked design
 * decisions — docs are meant to be read, not stared at.
 *
 * Sections, top → bottom:
 *   1. TL;DR (3 sentences, the elevator pitch)
 *   2. Architecture diagram (SVG: agent → /api/sessions → facilitator,
 *      DDB persist, Daily room, meeting.ended → settle)
 *   3. Why these choices (4 short rationale blocks)
 *   4. Milestone tx grid (M1–M4 BaseScan links)
 *   5. Tech stack table (package + version)
 *   6. Mitigations (5 paranoid items, all referenced in code)
 *   7. Open source footer
 *
 * Future maintenance note: this page hardcodes a snapshot of the
 * package versions at M4.5 ship time. It does NOT reflect-read
 * package.json at request time (that would require the server to bundle
 * the file as a data import; not worth the build-graph complication for
 * a hackathon). When dependencies change, update `TECH_STACK` below.
 */

import Link from 'next/link';
import {
  ArrowRight,
  Code2,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';

import { BASESCAN_TX_BASE_URL } from '@/lib/constants';

export const metadata = {
  title: 'PayPhone — docs',
  description:
    'Technical reference for PayPhone: architecture, x402 + Permit2 design choices, milestone proofs, mitigations.',
};

/* ---------- Data ---------- */

const MILESTONES = [
  {
    id: 'M1',
    title: 'x402 round-trip on Sepolia',
    body: 'Hand-rolled 402 → verify → settle with the `exact` scheme. Single $0.10 USDC transfer.',
    txHash: '0xc09fa4bf006b1937b7efc66e54725e02b55c992ac9bb9cd9f99d2492817c47bc',
    summary: '$0.10 settled · exact scheme',
  },
  {
    id: 'M2',
    title: 'Swap to `upto` scheme',
    body: 'Asymmetric verify/settle: signed up to $5, settled $0.30 — proxy enforces the cap on-chain.',
    txHash: '0x3b2625f01acfb4a2b583e76a6441da9d1dfef4defb06a51873a2f36534f09cd1',
    summary: '$0.30 settled of $5 max · upto scheme',
  },
  {
    id: 'M3',
    title: 'Daily.co + DDB + duration-derived settle',
    body: 'Real video room, meeting.ended webhook drives settle for floor(duration_sec) × $0.01.',
    txHash: '0xfc70cf0cc0f9142897c79c1a44ce7cf18bc20ccc7050f48b96e95d59ea29e781',
    summary: '88s call → $0.88 settled',
  },
  {
    id: 'M4',
    title: 'Frontend: marketplace + live ticker + recap',
    body: 'Mock-auth login, expert cards, in-call billing ticker, streamed Haiku summary, follow-up chat over the transcript.',
    txHash: '0x47dab9fe331741037730c4da1e1c1d46f2cfd5309db4311b3d57745739d6e33a',
    summary: '85s call → $0.84 settled · 61 transcript lines',
  },
] as const;

const TECH_STACK = [
  { group: 'Runtime', name: 'Next.js', version: '16.2.4' },
  { group: 'Runtime', name: 'React', version: '19.2.4' },
  { group: 'Runtime', name: 'TypeScript', version: '5.x' },
  { group: 'Runtime', name: 'Tailwind CSS', version: '4.x' },
  { group: 'Payments', name: '@coinbase/cdp-sdk', version: '1.48.2' },
  { group: 'Payments', name: '@coinbase/x402', version: '2.1.0' },
  { group: 'Payments', name: '@x402/core', version: '2.11.0' },
  { group: 'Payments', name: '@x402/evm', version: '2.9.0' },
  { group: 'Payments', name: 'viem', version: '2.48.8' },
  { group: 'Video', name: '@daily-co/daily-js', version: '0.89.1' },
  { group: 'Cloud', name: '@aws-sdk/client-dynamodb', version: '3.1043.x' },
  { group: 'AI', name: '@anthropic-ai/sdk', version: '0.94.0' },
  { group: 'AI', name: 'ai (Vercel AI SDK)', version: '6.0.x' },
  { group: 'UI', name: 'motion', version: '12.38.0' },
  { group: 'UI', name: 'lucide-react', version: '1.14.0' },
  { group: 'UI', name: 'shadcn/ui CLI', version: '4.7.0' },
] as const;

const RATIONALE = [
  {
    title: 'Why `upto`, not `exact`',
    body: 'The `exact` scheme requires the buyer to know the price in advance. We don\u2019t — duration is whatever the call ends up being. With `upto`, the buyer signs a "I\u2019ll spend at most $5" witness; the proxy contract enforces `amount <= permitted.amount` on-chain via `AmountExceedsPermitted`. Unspent allowance never moves; the chain doesn\u2019t care that we asked for less than we authorized.',
  },
  {
    title: 'Why hand-rolled, not paymentMiddleware',
    body: 'CDP\u2019s `paymentMiddleware` / `withX402` settles at request-time. We need to defer settlement until the call hangs up — that\u2019s the entire pitch. Hand-rolling the 402 → verify → settle dance lets `verify` run when the buyer signs (synchronous, fail-fast on bad payment) but `settle` run from the Daily.co `meeting.ended` webhook (asynchronous, with the actual duration in hand).',
  },
  {
    title: 'Why Permit2',
    body: 'Two USDC schemes are available on EVM: EIP-3009 (`transferWithAuthorization`) and Permit2 (`signatureTransfer`). EIP-3009 is fixed-amount: signing for $5 means $5 moves, period. Permit2 supports underspend: the witness says "up to $5," the actual transfer can be any value $0 \u2264 x \u2264 $5. There is no other primitive on EVM that lets a single signature authorize a range and the chain enforce the cap.',
  },
  {
    title: 'Why CDP Agentic Wallets',
    body: 'The buyer-side agent signs without holding ETH. CDP\u2019s facilitator declares `eip2612GasSponsoring` + `erc20ApprovalGasSponsoring` extensions in the 402 challenge; the buyer signs an EIP-2612 permit + the Permit2 witness, and the facilitator combines them into a single sponsored transaction. The buyer wallet stays gas-free. This is what makes "no-wallet AI agents" work for the consumer side — they show up with an api key, not a funded EOA.',
  },
] as const;

const MITIGATIONS = [
  {
    title: 'Issue #1065: gas estimation flake',
    body: 'CDP mainnet `/settle` returns "unable to estimate gas" ~40% of the time. We wrap settle in retry-with-backoff (3 attempts: 2s, 5s, 10s) in `lib/x402.ts:settleWithRetry`. Pre-warming the buyer wallet with a tiny dry-run before stage cuts the rate further.',
  },
  {
    title: 'Permit2 first-time approval',
    body: 'A buyer\u2019s first `upto` payment requires `approve(Permit2, max_uint256)` on USDC. We declare `erc20ApprovalGasSponsoring` in `PaymentRequirements.extensions`, so the facilitator pays the gas for the approval. Done once per wallet during dress rehearsal #1; subsequent calls skip it.',
  },
  {
    title: 'EIP-712 domain mismatch',
    body: 'USDC\u2019s `name()` differs by network: `"USD Coin"` on mainnet, `"USDC"` on Sepolia. Hardcoding the wrong value silently produces a signature the facilitator\u2019s on-chain `staticcall` rejects with revert. `lib/constants.ts:USDC_DOMAIN` is keyed by network, derived empirically from `probe-usdc.ts`.',
  },
  {
    title: 'Idempotent settle (double-spend guard)',
    body: 'Daily\u2019s webhook retries on non-2xx (3 attempts before circuit-open). `lib/db.ts:markSessionCompleted` is conditional on `status = AUTHORIZED`; the second call fails with `ConditionalCheckFailedException`, which the route catches and returns 200 to stop further retries. The Permit2 nonce inside the witness is consumed on first settle and prevents a duplicate transfer at the contract level too.',
  },
  {
    title: 'Daily safety rails',
    body: 'No cloud recording (billable, no free tier). No live streaming, no telephony. Rooms set `exp = now + 30 min` and `eject_at_room_exp: true`; transcription stops when the last participant leaves. Webhook signatures are HMAC-SHA256 verified against `DAILY_WEBHOOK_SECRET` using `crypto.timingSafeEqual`.',
  },
] as const;

/* ---------- Page ---------- */

export default function DocsPage() {
  return (
    <main
      className="flex flex-1 flex-col"
      // CSS-only dotted grid via repeated radial gradient. No JS, no
      // canvas — pure paint. The mask fades the dots toward the bottom
      // so they don't compete with the page footer's border.
      style={{
        backgroundColor: 'var(--color-payphone-bg)',
        backgroundImage:
          'radial-gradient(circle at center, color-mix(in srgb, var(--color-payphone-border) 70%, transparent) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-28 sm:pt-32 md:px-8 md:pt-36">
        {/* Page header */}
        <header className="mb-12 flex flex-col gap-3 md:mb-16">
          <p className="text-xs font-semibold uppercase tracking-wider text-payphone-blue md:text-sm">
            Documentation
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-payphone-ink md:text-5xl lg:text-6xl">
            How PayPhone works.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-payphone-ink-muted md:text-lg">
            A 72-hour build for EasyA Consensus Miami 2026. Below: the architecture, the design
            choices that surprised us, and the four on-chain proofs.
          </p>
        </header>

        <TLDR />
        <ArchitectureSection />
        <RationaleSection />
        <MilestonesSection />
        <TechStackSection />
        <MitigationsSection />
        <OpenSourceFooter />
      </div>
    </main>
  );
}

/* ---------- Reusable section card ---------- */

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-6 flex flex-col gap-2 md:mb-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-payphone-blue md:text-sm">
        {eyebrow}
      </p>
      <h2 className="text-2xl font-semibold tracking-tight text-payphone-ink md:text-3xl">
        {title}
      </h2>
    </div>
  );
}

/* ---------- 1. TL;DR ---------- */

function TLDR() {
  return (
    <section className="mb-16 md:mb-20">
      <SectionHeader eyebrow="TL;DR" title="The whole thing in three sentences." />
      <div className="rounded-2xl border border-payphone-border bg-payphone-surface p-6 md:p-8">
        <p className="text-base leading-relaxed text-payphone-ink md:text-lg">
          <span className="text-payphone-blue">PayPhone is per-second video billing on Base.</span>{' '}
          A buyer-side AI agent authorizes &ldquo;up to $5&rdquo; via x402&rsquo;s{' '}
          <code className="rounded bg-payphone-surface-elevated px-1.5 py-0.5 font-mono text-sm text-payphone-orange">
            upto
          </code>{' '}
          scheme; when the call ends, on-chain settlement transfers only the actual amount used in
          one Permit2 USDC transfer. Built for{' '}
          <span className="text-payphone-orange">EasyA Consensus Miami 2026</span> — Agentic Track,
          Coinbase + AWS sponsored.
        </p>
      </div>
    </section>
  );
}

/* ---------- 2. Architecture ---------- */

function ArchitectureSection() {
  return (
    <section className="mb-16 md:mb-20">
      <SectionHeader eyebrow="Architecture" title="Three phases. One signature. One transfer." />

      {/* SVG fixed viewBox; on mobile, the parent's `overflow-x-auto` lets
          users scroll horizontally if the viewport is narrower than the
          natural width. The SVG itself has w-full so it scales up on
          desktop. */}
      <div className="overflow-x-auto rounded-2xl border border-payphone-border bg-payphone-surface p-4 md:p-8">
        <svg
          viewBox="0 0 760 560"
          xmlns="http://www.w3.org/2000/svg"
          className="block min-w-[680px] w-full"
          role="img"
          aria-label="PayPhone three-phase architecture: authorize, talk, settle"
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-payphone-blue)" />
            </marker>
            <marker
              id="arrow-orange"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-payphone-orange)" />
            </marker>
          </defs>

          {/* ───── PHASE 1: AUTHORIZE ───── */}
          <text
            x="20"
            y="48"
            fontSize="11"
            fontWeight="700"
            letterSpacing="2"
            fill="var(--color-payphone-blue)"
          >
            01 · AUTHORIZE
          </text>
          <text x="20" y="68" fontSize="13" fill="var(--color-payphone-ink-muted)">
            Browser signs &ldquo;up to $5&rdquo;; backend verifies + creates room + persists.
          </text>

          {/* Boxes (row y≈100) */}
          <ArchBox x={20} y={100} w={150} title="Browser" sub="(buyer agent)" />
          <ArchBox x={295} y={100} w={170} title="/api/sessions" sub="(Next.js)" emphasized />
          <ArchBox x={590} y={40} w={150} title="CDP Facilitator" sub="verify" muted />
          <ArchBox x={590} y={160} w={150} title="Daily.co" sub="createRoom" muted />
          <ArchBox x={295} y={210} w={170} title="DynamoDB" sub="status: AUTHORIZED" muted />

          {/* Arrows */}
          <ArchArrow from={[170, 130]} to={[295, 130]} label="signed POST" labelY={120} />
          <ArchArrow from={[465, 115]} to={[590, 80]} label="verify" />
          <ArchArrow from={[465, 145]} to={[590, 200]} label="createRoom" />
          <ArchArrow from={[380, 165]} to={[380, 210]} label="" vertical />

          {/* ───── PHASE 2: TALK ───── */}
          <text
            x="20"
            y="298"
            fontSize="11"
            fontWeight="700"
            letterSpacing="2"
            fill="var(--color-payphone-orange)"
          >
            02 · TALK
          </text>
          <text x="20" y="318" fontSize="13" fill="var(--color-payphone-ink-muted)">
            Live video. Ticker counts up. No on-chain activity yet.
          </text>

          <ArchBox x={20} y={350} w={150} title="Browser" sub="(in-call)" />
          <ArchBox x={295} y={350} w={170} title="Daily Room" sub="WebRTC + transcription" />
          <ArchBox x={590} y={350} w={150} title="Browser" sub="(expert)" />

          <ArchArrow from={[170, 380]} to={[295, 380]} label="WebRTC" doubleArrow color="orange" />
          <ArchArrow from={[465, 380]} to={[590, 380]} label="WebRTC" doubleArrow color="orange" />

          {/* ───── PHASE 3: SETTLE ───── */}
          <text
            x="20"
            y="448"
            fontSize="11"
            fontWeight="700"
            letterSpacing="2"
            fill="var(--color-payphone-success)"
          >
            03 · SETTLE
          </text>
          <text x="20" y="468" fontSize="13" fill="var(--color-payphone-ink-muted)">
            User hangs up. One USDC transfer. DDB flipped to COMPLETED.
          </text>

          <ArchBox x={20} y={500} w={150} title="Daily.co" sub="meeting.ended" muted />
          <ArchBox
            x={295}
            y={500}
            w={170}
            title="/api/webhooks/daily"
            sub="HMAC-verified"
            emphasized
          />
          <ArchBox x={590} y={500} w={150} title="Base mainnet" sub="USDC transfer" />

          <ArchArrow from={[170, 530]} to={[295, 530]} label="POST (HMAC)" />
          <ArchArrow from={[465, 530]} to={[590, 530]} label="settle (via CDP)" color="orange" />
        </svg>
      </div>

      {/* Caption / glossary */}
      <p className="mt-4 text-sm leading-relaxed text-payphone-ink-muted">
        The settlement amount is{' '}
        <code className="rounded bg-payphone-surface-elevated px-1.5 py-0.5 font-mono text-xs text-payphone-orange">
          floor(duration_sec) × $0.01
        </code>
        , capped at the signed maximum. The unspent allowance simply expires on-chain — no refund
        path, no leftover state.
      </p>
    </section>
  );
}

/* ---------- Arch SVG primitives ---------- */

function ArchBox({
  x,
  y,
  w,
  title,
  sub,
  emphasized = false,
  muted = false,
}: {
  x: number;
  y: number;
  w: number;
  title: string;
  sub: string;
  emphasized?: boolean;
  muted?: boolean;
}) {
  const fill = emphasized
    ? 'color-mix(in srgb, var(--color-payphone-blue) 15%, var(--color-payphone-surface-elevated))'
    : 'var(--color-payphone-surface-elevated)';
  const stroke = emphasized
    ? 'var(--color-payphone-blue)'
    : muted
      ? 'var(--color-payphone-border)'
      : 'var(--color-payphone-border)';
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={60}
        rx={8}
        ry={8}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
      />
      <text
        x={x + w / 2}
        y={y + 26}
        fontSize="14"
        fontWeight="600"
        textAnchor="middle"
        fill="var(--color-payphone-ink)"
      >
        {title}
      </text>
      <text
        x={x + w / 2}
        y={y + 44}
        fontSize="11"
        textAnchor="middle"
        fill="var(--color-payphone-ink-muted)"
      >
        {sub}
      </text>
    </g>
  );
}

function ArchArrow({
  from,
  to,
  label,
  labelY,
  vertical = false,
  doubleArrow = false,
  color = 'blue',
}: {
  from: [number, number];
  to: [number, number];
  label: string;
  labelY?: number;
  vertical?: boolean;
  doubleArrow?: boolean;
  color?: 'blue' | 'orange';
}) {
  const stroke = color === 'orange' ? 'var(--color-payphone-orange)' : 'var(--color-payphone-blue)';
  const marker = color === 'orange' ? 'url(#arrow-orange)' : 'url(#arrow)';
  return (
    <g>
      <line
        x1={from[0]}
        y1={from[1]}
        x2={to[0]}
        y2={to[1]}
        stroke={stroke}
        strokeWidth={1.5}
        markerEnd={marker}
        markerStart={doubleArrow ? marker : undefined}
      />
      {label.length > 0 && (
        <text
          x={vertical ? from[0] + 8 : (from[0] + to[0]) / 2}
          y={labelY ?? (vertical ? (from[1] + to[1]) / 2 : Math.min(from[1], to[1]) - 6)}
          fontSize="11"
          fill="var(--color-payphone-ink-muted)"
          textAnchor={vertical ? 'start' : 'middle'}
        >
          {label}
        </text>
      )}
    </g>
  );
}

/* ---------- 3. Rationale ---------- */

function RationaleSection() {
  return (
    <section className="mb-16 md:mb-20">
      <SectionHeader eyebrow="Why these choices" title="Four decisions that shaped the build." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
        {RATIONALE.map((item) => (
          <article
            key={item.title}
            className="rounded-2xl border border-payphone-border bg-payphone-surface p-6 md:p-8"
          >
            <h3 className="mb-3 text-lg font-semibold text-payphone-ink md:text-xl">
              {item.title}
            </h3>
            <p className="text-sm leading-relaxed text-payphone-ink-muted md:text-base">
              {item.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ---------- 4. Milestones ---------- */

function MilestonesSection() {
  return (
    <section className="mb-16 md:mb-20">
      <SectionHeader eyebrow="On-chain proofs" title="Four milestones, four BaseScan links." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {MILESTONES.map((m) => {
          const url = `${BASESCAN_TX_BASE_URL}${m.txHash}`;
          const shortHash = `${m.txHash.slice(0, 10)}…${m.txHash.slice(-8)}`;
          return (
            <a
              key={m.id}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col gap-3 rounded-2xl border border-payphone-border bg-payphone-surface p-6 transition-all hover:-translate-y-0.5 hover:border-payphone-orange/50 hover:shadow-lg hover:shadow-payphone-orange/10 md:p-8"
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex h-7 min-w-12 items-center justify-center rounded-full bg-payphone-blue/10 px-3 text-xs font-semibold text-payphone-blue">
                  {m.id}
                </span>
                <ExternalLink
                  className="h-4 w-4 text-payphone-ink-muted transition-colors group-hover:text-payphone-orange"
                  aria-hidden="true"
                />
              </div>
              <h3 className="text-base font-semibold text-payphone-ink md:text-lg">{m.title}</h3>
              <p className="text-sm leading-relaxed text-payphone-ink-muted">{m.body}</p>
              <div className="mt-auto flex flex-col gap-1 border-t border-payphone-border pt-3">
                <span className="text-xs font-medium uppercase tracking-wider text-payphone-orange">
                  {m.summary}
                </span>
                <span className="font-mono text-[11px] text-payphone-ink-muted/80">
                  {shortHash}
                </span>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- 5. Tech stack ---------- */

function TechStackSection() {
  // Group by `group` for visual grouping in the table — Runtime / Payments
  // / Video / Cloud / AI / UI. Keys preserve insertion order in modern JS.
  const groups = TECH_STACK.reduce<Record<string, (typeof TECH_STACK)[number][]>>((acc, item) => {
    const list = acc[item.group] ?? [];
    list.push(item);
    acc[item.group] = list;
    return acc;
  }, {});

  return (
    <section className="mb-16 md:mb-20">
      <SectionHeader eyebrow="Tech stack" title="What the dependencies look like." />
      <div className="overflow-hidden rounded-2xl border border-payphone-border bg-payphone-surface">
        <table className="w-full text-left text-sm md:text-base">
          <thead className="border-b border-payphone-border bg-payphone-surface-elevated/40">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted md:px-6">
                Group
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted md:px-6">
                Package
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted md:px-6">
                Version
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(groups).flatMap(([group, items]) =>
              items.map((item, idx) => (
                <tr key={item.name} className="border-b border-payphone-border/60 last:border-b-0">
                  <td className="px-4 py-3 align-top md:px-6">
                    {idx === 0 && (
                      <span className="text-xs font-semibold uppercase tracking-wider text-payphone-blue">
                        {group}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-payphone-ink md:px-6">{item.name}</td>
                  <td className="px-4 py-3 text-right font-mono text-payphone-ink-muted md:px-6">
                    {item.version}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- 6. Mitigations ---------- */

function MitigationsSection() {
  return (
    <section className="mb-16 md:mb-20">
      <SectionHeader eyebrow="Mitigations" title="Five things that bite, all guarded for." />
      <ol className="flex flex-col gap-3 md:gap-4">
        {MITIGATIONS.map((m, idx) => (
          <li
            key={m.title}
            className="flex gap-4 rounded-2xl border border-payphone-border bg-payphone-surface p-5 md:p-6"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-payphone-orange/10 text-sm font-semibold text-payphone-orange">
              {idx + 1}
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-base font-semibold text-payphone-ink md:text-lg">{m.title}</h3>
              <p className="text-sm leading-relaxed text-payphone-ink-muted md:text-base">
                {m.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- 7. Open-source footer ---------- */

function OpenSourceFooter() {
  return (
    <section className="mb-8">
      <div className="flex flex-col gap-6 rounded-2xl border border-payphone-border bg-gradient-to-br from-payphone-surface to-payphone-surface-elevated/60 p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-payphone-orange" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider text-payphone-orange">
              72 hours · MIT licensed
            </span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-payphone-ink md:text-3xl">
            Read the code, file an issue.
          </h2>
          <p className="text-sm text-payphone-ink-muted md:text-base">
            Every line is on GitHub. The README walks through running it locally with seeded
            credentials and a Sepolia faucet drip.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row md:flex-col md:gap-2">
          <a
            href="https://github.com/Achyut21/payphone"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-payphone-blue px-5 py-2.5 text-sm font-semibold text-payphone-ink shadow-md shadow-payphone-blue/20 transition-all hover:bg-payphone-blue/90 hover:shadow-lg hover:shadow-payphone-blue/30 md:text-base"
          >
            <Code2 className="h-4 w-4" aria-hidden="true" />
            View repo
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-payphone-border bg-payphone-surface px-5 py-2.5 text-sm font-medium text-payphone-ink transition-colors hover:border-payphone-orange/50 hover:bg-payphone-surface-elevated md:text-base"
          >
            <TerminalSquare className="h-4 w-4 text-payphone-orange" aria-hidden="true" />
            Try the demo
          </Link>
        </div>
      </div>
      <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-payphone-ink-muted/70">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Buyer wallets are seeded testnet keys. Don&rsquo;t paste a real private key into a hackathon
        demo. Ever.
      </p>
    </section>
  );
}
