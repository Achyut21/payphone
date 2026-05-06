/**
 * PayPhone — login guard (Next 16+ proxy convention).
 *
 * Renamed from `middleware.ts` per the Next 16 deprecation: the file
 * convention moved to `proxy.ts` and the exported function from
 * `middleware()` to `proxy()`. Matcher config is the actual policy.
 *
 * M4.5 routing — public vs protected:
 *   - PUBLIC:    `/` (marketing landing), `/login`, `/docs`, `/api/*`
 *   - PROTECTED: `/marketplace` (logged-in expert browse),
 *                `/session/:path*` (call + recap)
 *
 * The marketplace's path moved from `/` to `/marketplace` in M4.5 so the
 * root URL can host the marketing landing for unauthenticated visitors.
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
 * Matcher: protect `/marketplace` and any `/session/...` path. Listing
 * them explicitly (vs. a "match everything except API+static" negative
 * lookahead) is clearer at our scale and keeps `/`, `/login`, `/docs`,
 * `/api/*`, and static assets out of the proxy entirely.
 */
export const config = {
  matcher: ['/marketplace', '/session/:path*'],
};
