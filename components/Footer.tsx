'use client';

/**
 * PayPhone — global footer.
 *
 * Three columns on desktop, stacked on mobile. Renders on every page
 * EXCEPT the session and recap pages (the immersive call has no chrome,
 * and the recap is a focused single-purpose experience that should end
 * with a "back to marketplace" CTA, not a sprawling site footer).
 *
 * Client Component so it can use `usePathname` for the route check.
 * The content itself is static — no user state, no client effects.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PhoneCall } from 'lucide-react';

const PRODUCT_LINKS: readonly { name: string; href: string; external?: boolean }[] = [
  { name: 'Marketplace', href: '/marketplace' },
  { name: 'Docs', href: '/docs' },
  { name: 'GitHub', href: 'https://github.com/Achyut21/payphone', external: true },
];

const ATTRIBUTION_LINKS: readonly { name: string; href: string; description: string }[] = [
  {
    name: 'x402',
    href: 'https://www.x402.org',
    description: 'HTTP payments protocol',
  },
  {
    name: 'Coinbase CDP',
    href: 'https://www.coinbase.com/developer-platform',
    description: 'Server wallets + facilitator',
  },
  {
    name: 'Daily.co',
    href: 'https://www.daily.co',
    description: 'Video infrastructure',
  },
];

/** Hide footer on `/session/<id>` AND `/session/<id>/recap`. */
const HIDE_FOOTER_PATTERN = /^\/session\//;

export function Footer() {
  const pathname = usePathname();
  if (HIDE_FOOTER_PATTERN.test(pathname)) return null;

  return (
    <footer className="mt-20 border-t border-payphone-border bg-payphone-surface/40">
      <div className="mx-auto w-full max-w-6xl px-6 py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-3">
          {/* Wordmark + tagline */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-payphone-ink">
              <PhoneCall className="h-4 w-4 text-payphone-blue" aria-hidden="true" />
              <span className="text-base font-semibold tracking-tight">PayPhone</span>
            </div>
            <p className="text-sm leading-relaxed text-payphone-ink-muted">
              Per-second video calls, settled in one on-chain USDC transfer when you hang up.
            </p>
            <p className="text-xs font-medium uppercase tracking-wider text-payphone-blue">
              Built on Base
            </p>
          </div>

          {/* Product links */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted">
              Product
            </h3>
            <ul className="flex flex-col gap-2">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-payphone-ink-muted transition-colors hover:text-payphone-ink"
                    >
                      {link.name}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="text-sm text-payphone-ink-muted transition-colors hover:text-payphone-ink"
                    >
                      {link.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Built with attribution */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-payphone-ink-muted">
              Built with
            </h3>
            <ul className="flex flex-col gap-2">
              {ATTRIBUTION_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex flex-col gap-0.5"
                  >
                    <span className="text-sm font-medium text-payphone-ink-muted transition-colors group-hover:text-payphone-ink">
                      {link.name}
                    </span>
                    <span className="text-xs text-payphone-ink-muted/70">{link.description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom row */}
        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-payphone-border pt-6 text-xs text-payphone-ink-muted md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} PayPhone. MIT licensed.</p>
          <p>Built for EasyA Consensus Miami 2026.</p>
        </div>
      </div>
    </footer>
  );
}
