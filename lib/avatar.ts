/**
 * PayPhone — avatar URL helper.
 *
 * Backed by DiceBear's hosted API (https://www.dicebear.com/styles/personas)
 * rather than the local `@dicebear/core` lib. The lib is ESM-only as of
 * v9; mixing it with our `node16` CJS-style tsconfig + Next 16's auto-
 * generated CJS `.next/types/validator.ts` triggers cascading
 * `TS1542` / `TS2307` failures during `pnpm build`.
 *
 * Visual output is identical (same `personas` style, same seed → same
 * SVG). Trade-off:
 *   - Plus: no client/server bundle bloat, no SSR CPU per render, zero
 *     ESM/CJS friction.
 *   - Minus: one CDN round-trip per avatar from the user's browser. The
 *     DiceBear CDN sets long Cache-Control so subsequent loads are free.
 *
 * `@dicebear/core` and `@dicebear/collection` are still in package.json
 * — kept for the case we want to swap to local SSR generation in M5+
 * (would need a `.mts` shim or tsconfig overhaul).
 */

const DICEBEAR_BASE = 'https://api.dicebear.com/9.x/personas/svg' as const;

export function avatarUrl(seed: string, options: { backgroundColor?: string } = {}): string {
  const params = new URLSearchParams({ seed });
  if (options.backgroundColor) {
    // DiceBear expects bare hex without the `#`.
    params.set('backgroundColor', options.backgroundColor.replace(/^#/, ''));
  }
  return `${DICEBEAR_BASE}?${params.toString()}`;
}
