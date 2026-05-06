/**
 * PayPhone — seeded demo data.
 *
 * Three demo "users" (login as Alice/Bob/Charlie) and four "experts" (the
 * marketplace cards). No DB, no admin panel — these are hardcoded values.
 *
 * Per-second billing math is uniform across all experts in M4: every
 * session settles for `floor(duration_sec) × M3_PER_SECOND_RATE_ATOMIC`
 * = $0.01/sec. The `displayRate` strings on each expert are MARKETING
 * COPY ONLY — they vary on the cards to make the marketplace feel real,
 * but the on-chain settle is identical regardless of which expert the
 * user picks. M5+ may diverge per-expert rates with care; doing so
 * requires plumbing a per-session rate through the buyer signing
 * context AND the webhook settle path. Don't change `displayRate`
 * expecting it to flow through to chain math — it doesn't.
 */

export type DemoUser = {
  /** Stable id; used as cookie value. */
  id: string;
  name: string;
  /** Seed for DiceBear avatar (deterministic per id). */
  avatarSeed: string;
  /**
   * Short persona tagline shown on the login picker (M4.5). Two facets
   * separated by `·`, e.g. "Web3 founder · power user". Keeps the demo
   * users feeling like distinct personas rather than interchangeable
   * radio-button labels.
   */
  tagline: string;
};

export type DemoExpert = {
  /** Stable id; persisted as `expert_id` on the session row. */
  id: string;
  name: string;
  /** Short specialty label (one line, shown next to icon on card). */
  specialty: string;
  /** Lucide icon name; resolved in components/ExpertCard. */
  iconName: 'Code2' | 'Cpu' | 'Sparkles' | 'Cog';
  bio: string;
  /** Marketing label like "$2/min". DOES NOT drive on-chain math (see header). */
  displayRate: string;
  avatarSeed: string;
};

export const DEMO_USERS: readonly DemoUser[] = [
  {
    id: 'alice',
    name: 'Alice',
    avatarSeed: 'alice-payphone',
    tagline: 'Web3 founder · power user',
  },
  { id: 'bob', name: 'Bob', avatarSeed: 'bob-payphone', tagline: 'Solidity dev · day-trader' },
  {
    id: 'charlie',
    name: 'Charlie',
    avatarSeed: 'charlie-payphone',
    tagline: 'DAO maintainer · multi-tasker',
  },
] as const;

export const DEMO_EXPERTS: readonly DemoExpert[] = [
  {
    id: 'expert-alice-chen',
    name: 'Alice Chen',
    specialty: 'Solidity & smart contracts',
    iconName: 'Code2',
    bio: 'Audits and architecture for ERC-4337, Permit2, and L2 settlement flows. Ex-Optimism.',
    displayRate: '$2/min',
    avatarSeed: 'expert-alice-chen',
  },
  {
    id: 'expert-marcus-rivera',
    name: 'Marcus Rivera',
    specialty: 'Rust & systems',
    iconName: 'Cpu',
    bio: 'Low-latency Rust services, lock-free data structures, embedded firmware. Available for protocol design.',
    displayRate: '$3/min',
    avatarSeed: 'expert-marcus-rivera',
  },
  {
    id: 'expert-priya-shah',
    name: 'Priya Shah',
    specialty: 'UX & product',
    iconName: 'Sparkles',
    bio: 'Product strategy + interaction design for fintech and developer tools. 0→1 specialist.',
    displayRate: '$2/min',
    avatarSeed: 'expert-priya-shah',
  },
  {
    id: 'expert-tomas-brandt',
    name: 'Tomás Brandt',
    specialty: 'DevOps & infra',
    iconName: 'Cog',
    bio: 'Kubernetes, Terraform, observability. Cuts cloud bills and on-call pain in half.',
    displayRate: '$4/min',
    avatarSeed: 'expert-tomas-brandt',
  },
] as const;

/** Lookup helper. Returns null if no match. */
export function findUserById(id: string | undefined): DemoUser | null {
  if (!id) return null;
  return DEMO_USERS.find((u) => u.id === id) ?? null;
}

/** Lookup helper. Returns null if no match. */
export function findExpertById(id: string | undefined): DemoExpert | null {
  if (!id) return null;
  return DEMO_EXPERTS.find((e) => e.id === id) ?? null;
}

/**
 * Auth cookie name. Defined here (not in `lib/auth.ts`) so that Edge-runtime
 * code paths like Next middleware can read it without pulling in the
 * `server-only` `next/headers` API used by the auth helpers.
 */
export const AUTH_COOKIE_NAME = 'payphone_user';
