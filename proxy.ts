/**
 * PayPhone — login guard (Next 16+ proxy convention, M5 NextAuth-backed).
 *
 * Renamed from `middleware.ts` per the Next 16 deprecation: the file
 * convention moved to `proxy.ts`. NextAuth v5's `auth()` factory returns
 * a request-handler function that exposes `req.auth` (the resolved
 * session, or null) — we wrap that into the default export and run our
 * route policy against it.
 *
 * Routing — public vs protected (M5 unchanged from M4.5):
 *   - PUBLIC:    `/` (marketing landing), `/login`, `/docs`,
 *                `/api/auth/*` (NextAuth handlers themselves)
 *   - PROTECTED: `/marketplace` and any sub-route, `/session/:path*`
 *
 * The `matcher` config below restricts the proxy to the protected
 * paths, so the NextAuth `/api/auth/*` routes never even invoke this
 * guard. Other API routes (`/api/sessions/*`, `/api/webhooks/*`) are
 * also intentionally excluded from the proxy: they handle auth
 * themselves where required, and the webhook is unauthenticated by
 * design (HMAC-verified, not session-verified).
 */

import { auth } from '@/auth';

export default auth((req) => {
  const isAuthed = !!req.auth;
  if (!isAuthed) {
    const loginUrl = new URL('/login', req.url);
    return Response.redirect(loginUrl);
  }
  // No explicit return = let the request through.
});

/**
 * Matcher: protect `/marketplace` (and any sub-route) and any
 * `/session/...` path. Listing them explicitly (vs. a "match everything
 * except API+static" negative lookahead) is clearer at our scale and
 * keeps `/`, `/login`, `/docs`, `/api/*`, and static assets out of the
 * proxy entirely.
 */
export const config = {
  matcher: ['/marketplace/:path*', '/session/:path*'],
};
