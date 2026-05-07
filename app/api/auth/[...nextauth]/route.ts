/**
 * NextAuth catch-all route handler.
 *
 * Re-exports the GET/POST handlers from the root `auth.ts` factory.
 * Covers:
 *   - GET  /api/auth/signin            (default signin page — we override
 *                                       to /login via `pages.signIn`)
 *   - GET  /api/auth/callback/cognito  (OAuth2 code exchange)
 *   - POST /api/auth/signin/cognito    (initiate signin)
 *   - GET  /api/auth/signout           (signout)
 *   - GET  /api/auth/session           (session probe — used by useSession)
 *   - GET  /api/auth/csrf              (CSRF token)
 *
 * `runtime = 'nodejs'` is mandatory: the Cognito provider talks to AWS
 * via `oauth4webapi`, which uses `crypto` APIs that are unavailable on
 * the Edge runtime. CONTEXT.md also requires nodejs runtime on every
 * route that touches CDP/AWS/crypto.
 *
 * NextAuth v5 packs both methods into a single `handlers` object — we
 * destructure them on the way out so Next sees individual GET/POST
 * exports as it expects.
 */

import { handlers } from '@/auth';

export const { GET, POST } = handlers;

export const runtime = 'nodejs';
