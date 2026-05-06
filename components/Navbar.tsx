/**
 * PayPhone — top-level navbar.
 *
 * Server Component. Resolves the current user via the auth cookie and
 * hands the result off to the client `<NavbarShell />`. The split is
 * required because the navbar's scroll-aware width animation, mobile
 * drawer toggle, and `usePathname()` route-aware render-skip all need
 * to run on the client; the user resolution itself uses the
 * `next/headers` cookie API which is server-only.
 *
 * Mounted from `app/layout.tsx`; rendered on every route in the app.
 * `<NavbarShell />` itself returns `null` on `/session/[id]` so the
 * immersive video page renders without chrome.
 */

import { getCurrentUser } from '@/lib/auth';

import { NavbarShell } from './NavbarShell';

export async function Navbar() {
  const user = await getCurrentUser();
  return <NavbarShell user={user} />;
}
