/**
 * PayPhone — login guard (Next 16+ proxy convention).
 *
 * Renamed from `middleware.ts` per the Next 16 deprecation: the file
 * convention moved to `proxy.ts` and the exported function from
 * `middleware()` to `proxy()`. Matcher config is unchanged.
 *
 * Single-source-of-truth route guard for protected pages. Runs at the
 * Edge (no Node APIs used) so the cookie check is fast and doesn't pull
 * `lib/auth.ts` (which uses `next/headers` + `server-only`).
 *
 * Protected matcher: `/` (marketplace) and `/session/*` (live + recap).
 * Everything else (`/login`, `/api/*`, static assets) is excluded by the
 * matcher config below — Next won't even invoke this for those paths.
 *
 * We don't validate the cookie value against the seed list here; we just
 * check it's non-empty. If a tampered/stale id slips through, the
 * downstream server component sees `getCurrentUser() === null` and
 * triggers its own redirect. This proxy is an early-exit convenience,
 * not the security boundary — the seeded auth itself is not a security
 * boundary.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { AUTH_COOKIE_NAME } from '@/lib/seed';

export function proxy(request: NextRequest): NextResponse {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  if (!cookie || cookie.value.length === 0) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

/**
 * Matcher: protect `/` and any `/session/...` path.
 *
 * The negative lookahead in the docs' "match everything except API+static"
 * default would be overkill here — we only have two protected route
 * groups. Listing them explicitly is clearer and avoids accidental
 * scope creep into `/api/*`.
 */
export const config = {
  matcher: ['/', '/session/:path*'],
};
