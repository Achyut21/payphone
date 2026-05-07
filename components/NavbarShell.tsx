'use client';

/**
 * PayPhone — navbar client shell (scroll-aware floating nav).
 *
 * Behavior:
 *   - Fixed/floating, centered, max-w-4xl on desktop / w-[calc(100%-2rem)]
 *     on mobile. Width compacts to max-w-2xl after scrolling past 50px
 *     (motion.nav animates `maxWidth`).
 *   - Backdrop blur + semi-transparent payphone-surface fill + 1px
 *     payphone-border ring.
 *   - Logged-out: [logo] [How it works · Docs · GitHub] [Get started].
 *   - Logged-in:  [logo] [Marketplace · Docs] [avatar · name · logout].
 *   - Mobile: [logo] [☰] — hamburger toggles a drop-down panel with the
 *     same items stacked vertically.
 *   - Returns `null` on the immersive session page (`/session/<id>`)
 *     but renders normally on the recap page (`/session/<id>/recap`),
 *     per the Phase 2 brief.
 *
 * Auth state: passed in as a prop (server-resolved). The cookie itself
 * is httpOnly so the client cannot read it directly.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useScroll, useMotionValueEvent, AnimatePresence } from 'motion/react';
import { LogOut, Menu, PhoneCall, X } from 'lucide-react';

import { logoutAction } from '@/app/_actions/auth';
import { avatarUrl } from '@/lib/avatar';
import { ACTIVE_NETWORK } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { AppUser } from '@/lib/auth';

/** Pull a short friendly handle out of an email — `someone@example.com` → `someone`. */
function emailHandle(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

/**
 * Tiny "Base Sepolia" / "Base Mainnet" pill rendered in the navbar.
 * Reads `ACTIVE_NETWORK` (resolved from `NEXT_PUBLIC_ACTIVE_NETWORK` at
 * build time) so it's correct in both dev and prod without any
 * server round-trip. Color matches the network's role:
 *   - Sepolia (testnet) → orange (signals "play money / testnet")
 *   - Mainnet (live)    → success-green (signals "real settlement")
 */
function NetworkBadge() {
  const isMainnet = ACTIVE_NETWORK === 'mainnet';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide',
        isMainnet
          ? 'bg-payphone-success/15 text-payphone-success'
          : 'bg-payphone-orange/15 text-payphone-orange',
      )}
      aria-label={`Active network: Base ${isMainnet ? 'Mainnet' : 'Sepolia'}`}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          isMainnet ? 'bg-payphone-success' : 'bg-payphone-orange',
        )}
        aria-hidden="true"
      />
      Base {isMainnet ? 'Mainnet' : 'Sepolia'}
    </span>
  );
}

type NavLink = { name: string; href: string; external?: boolean };

const LOGGED_OUT_LINKS: readonly NavLink[] = [
  { name: 'How it works', href: '/#how-it-works' },
  { name: 'Docs', href: '/docs' },
  { name: 'GitHub', href: 'https://github.com/Achyut21/payphone', external: true },
];

const LOGGED_IN_LINKS: readonly NavLink[] = [
  { name: 'Marketplace', href: '/marketplace' },
  { name: 'Docs', href: '/docs' },
];

/** Match `/session/<id>` exactly — NOT `/session/<id>/recap` (that gets chrome). */
const IMMERSIVE_SESSION_PATTERN = /^\/session\/[^/]+\/?$/;

export function NavbarShell({ user }: { user: AppUser | null }) {
  const pathname = usePathname();
  const [compact, setCompact] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, 'change', (y) => {
    setCompact(y > 50);
  });

  if (IMMERSIVE_SESSION_PATTERN.test(pathname)) return null;

  const links = user ? LOGGED_IN_LINKS : LOGGED_OUT_LINKS;
  const homeHref = user ? '/marketplace' : '/';

  return (
    <motion.nav
      animate={{ maxWidth: compact ? 672 : 896 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="fixed inset-x-0 top-3 z-50 mx-auto w-[calc(100%-1rem)] md:top-6 md:w-[calc(100%-3rem)]"
      aria-label="Primary"
    >
      <div className="flex items-center justify-between gap-3 rounded-full border border-payphone-border bg-payphone-surface/70 px-3 py-2 shadow-lg shadow-black/40 backdrop-blur-md md:px-4">
        {/* Wordmark + network badge */}
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={homeHref}
            className="flex items-center gap-2 rounded-full px-2 py-0.5 text-payphone-ink transition-colors hover:text-payphone-blue"
            aria-label="PayPhone home"
          >
            <PhoneCall className="h-4 w-4 text-payphone-blue" aria-hidden="true" />
            <span className="text-sm font-semibold tracking-tight md:text-base">PayPhone</span>
          </Link>
          {/* Hidden on the smallest screens — the mobile drawer surfaces it. */}
          <span className="hidden sm:inline-flex">
            <NetworkBadge />
          </span>
        </div>

        {/* Desktop nav links (centered) */}
        <div className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <DesktopNavLink key={link.href} link={link} />
          ))}
        </div>

        {/* Desktop right-side: CTA or user dropdown */}
        <div className="hidden items-center gap-2 md:flex">
          {user ? <UserMenu user={user} /> : <CtaButton />}
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav-drawer"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-payphone-ink transition-colors hover:bg-payphone-surface-elevated md:hidden"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <MobileDrawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        links={links}
        user={user}
      />
    </motion.nav>
  );
}

function DesktopNavLink({ link }: { link: NavLink }) {
  const pathname = usePathname();
  const isActive = !link.external && pathname === link.href;

  if (link.external) {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full px-3 py-1.5 text-sm font-medium text-payphone-ink-muted transition-colors hover:bg-payphone-surface-elevated hover:text-payphone-ink"
      >
        {link.name}
      </a>
    );
  }

  return (
    <Link
      href={link.href}
      className={cn(
        'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
        isActive
          ? 'bg-payphone-surface-elevated text-payphone-ink'
          : 'text-payphone-ink-muted hover:bg-payphone-surface-elevated hover:text-payphone-ink',
      )}
    >
      {link.name}
    </Link>
  );
}

function CtaButton() {
  return (
    <Link
      href="/login"
      className="rounded-full bg-payphone-blue px-4 py-1.5 text-sm font-semibold text-payphone-ink shadow-md shadow-payphone-blue/20 transition-all hover:bg-payphone-blue/90 hover:shadow-payphone-blue/30"
    >
      Get started
    </Link>
  );
}

function UserMenu({ user }: { user: AppUser }) {
  const handle = emailHandle(user.email);
  return (
    <div className="flex items-center gap-2 rounded-full bg-payphone-surface-elevated py-1 pl-1 pr-2">
      {/* Avatar — DiceBear hosted SVG, see lib/avatar.ts. M5 keys off email
          (Cognito users have no manual avatarSeed). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatarUrl(user.email)}
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 rounded-full bg-payphone-bg"
      />
      <span
        className="max-w-[12rem] truncate text-sm font-medium text-payphone-ink"
        title={user.email}
      >
        {handle}
      </span>
      <form action={logoutAction}>
        <button
          type="submit"
          aria-label="Log out"
          className="flex h-7 w-7 items-center justify-center rounded-full text-payphone-ink-muted transition-colors hover:bg-payphone-surface hover:text-payphone-ink"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}

function MobileDrawer({
  open,
  onClose,
  links,
  user,
}: {
  open: boolean;
  onClose: () => void;
  links: readonly NavLink[];
  user: AppUser | null;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          id="mobile-nav-drawer"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="mt-2 overflow-hidden rounded-2xl border border-payphone-border bg-payphone-surface/90 p-2 shadow-xl shadow-black/40 backdrop-blur-md md:hidden"
        >
          {/* Network badge surfaced in the drawer for the smallest viewports
              where it's hidden in the navbar header. */}
          <div className="mb-1 flex justify-end px-3 pt-1 sm:hidden">
            <NetworkBadge />
          </div>
          <nav className="flex flex-col gap-1">
            {links.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onClose}
                  className="rounded-xl px-3 py-3 text-base font-medium text-payphone-ink-muted transition-colors hover:bg-payphone-surface-elevated hover:text-payphone-ink"
                >
                  {link.name}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onClose}
                  className="rounded-xl px-3 py-3 text-base font-medium text-payphone-ink-muted transition-colors hover:bg-payphone-surface-elevated hover:text-payphone-ink"
                >
                  {link.name}
                </Link>
              ),
            )}
          </nav>

          <div className="mt-2 border-t border-payphone-border pt-2">
            {user ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatarUrl(user.email)}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 shrink-0 rounded-full bg-payphone-bg"
                  />
                  <span
                    className="truncate text-sm font-medium text-payphone-ink"
                    title={user.email}
                  >
                    {emailHandle(user.email)}
                  </span>
                </div>
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-payphone-surface-elevated px-3 py-2 text-sm font-medium text-payphone-ink transition-colors hover:bg-payphone-bg"
                  >
                    <LogOut className="h-4 w-4" />
                    Log out
                  </button>
                </form>
              </div>
            ) : (
              <Link
                href="/login"
                onClick={onClose}
                className="block rounded-xl bg-payphone-blue px-3 py-3 text-center text-base font-semibold text-payphone-ink shadow-md shadow-payphone-blue/20"
              >
                Get started
              </Link>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
