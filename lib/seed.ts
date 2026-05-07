/**
 * PayPhone — seeded demo data (M5 — experts only).
 *
 * Four hardcoded experts that populate the marketplace cards. No DB, no
 * admin panel — these are static values rendered server-side.
 *
 * History:
 *   - M4 had three `DemoUser` rows (Achyut/Bob/Charlie) used by the
 *     cookie-based seeded login. M5 replaced that with Cognito + per-
 *     user CDP wallets, and the demo-user list went away (this file
 *     used to define it). The user identity now flows from
 *     `lib/auth.ts.AppUser` derived from the Cognito session.
 *   - The cookie-name constant `AUTH_COOKIE_NAME` was deleted with
 *     the demo-user rows; NextAuth manages its own session cookie.
 *
 * Per-second billing math is uniform across all experts: every session
 * settles for `floor(active_window_duration_sec) ×
 * M3_PER_SECOND_RATE_ATOMIC` = $0.01/sec ($0.60/min). M5 Phase 5
 * harmonized the per-card `displayRate` strings to all read `$0.60/min`
 * — previously they varied (`$2/min`, `$3/min`, `$4/min`) which was
 * marketing-flavor only but contradicted the actual on-chain settle a
 * public user would see on BaseScan. Honest pricing > flavor.
 */

export type DemoExpert = {
  /** Stable id; persisted as `expert_id` on the session row. */
  id: string;
  name: string;
  /** Short specialty label (one line, shown next to icon on card). */
  specialty: string;
  /** Lucide icon name; resolved in components/ExpertCard. */
  iconName: 'Code2' | 'Cpu' | 'Sparkles' | 'Cog';
  bio: string;
  /**
   * Marketing label like `"$0.60/min"`. M5: harmonized across all
   * experts to match the actual on-chain settle rate. Driving on-chain
   * math from this field would require plumbing a per-session rate
   * through the buyer signing context AND the webhook settle path —
   * deferred per docs/STRETCH_GOALS.md.
   */
  displayRate: string;
  avatarSeed: string;
};

/** Uniform display rate matching the actual on-chain settle math. */
const HARMONIZED_RATE = '$0.60/min' as const;

export const DEMO_EXPERTS: readonly DemoExpert[] = [
  {
    id: 'expert-alice-chen',
    name: 'Alice Chen',
    specialty: 'Solidity & smart contracts',
    iconName: 'Code2',
    bio: 'Audits and architecture for ERC-4337, Permit2, and L2 settlement flows. Ex-Optimism.',
    displayRate: HARMONIZED_RATE,
    avatarSeed: 'expert-alice-chen',
  },
  {
    id: 'expert-marcus-rivera',
    name: 'Marcus Rivera',
    specialty: 'Rust & systems',
    iconName: 'Cpu',
    bio: 'Low-latency Rust services, lock-free data structures, embedded firmware. Available for protocol design.',
    displayRate: HARMONIZED_RATE,
    avatarSeed: 'expert-marcus-rivera',
  },
  {
    id: 'expert-priya-shah',
    name: 'Priya Shah',
    specialty: 'UX & product',
    iconName: 'Sparkles',
    bio: 'Product strategy + interaction design for fintech and developer tools. 0→1 specialist.',
    displayRate: HARMONIZED_RATE,
    avatarSeed: 'expert-priya-shah',
  },
  {
    id: 'expert-tomas-brandt',
    name: 'Tomás Brandt',
    specialty: 'DevOps & infra',
    iconName: 'Cog',
    bio: 'Kubernetes, Terraform, observability. Cuts cloud bills and on-call pain in half.',
    displayRate: HARMONIZED_RATE,
    avatarSeed: 'expert-tomas-brandt',
  },
] as const;

/** Lookup helper. Returns null if no match. */
export function findExpertById(id: string | undefined): DemoExpert | null {
  if (!id) return null;
  return DEMO_EXPERTS.find((e) => e.id === id) ?? null;
}
