/**
 * PayPhone — NextAuth v5 root config.
 *
 * Single source of truth for auth across the app. The `auth`, `signIn`,
 * `signOut`, and `handlers` exports are consumed by:
 *   - `app/api/auth/[...nextauth]/route.ts`  (the catch-all OAuth handler)
 *   - `proxy.ts`                              (the route guard, wraps
 *                                              this file's `auth()`
 *                                              into a Next 16 proxy)
 *   - `lib/auth.ts`                           (`getCurrentUser()` shim)
 *   - `app/login/page.tsx`                    (server-action signIn)
 *   - server actions / route handlers that need to know who the caller is
 *
 * Cognito provider notes:
 *   - `issuer` is the Cognito IDP URL of the form
 *     `https://cognito-idp.<region>.amazonaws.com/<pool-id>` — NextAuth
 *     appends `/.well-known/openid-configuration` itself, do NOT include
 *     that suffix.
 *   - `generate_secret = true` on the user pool client (Terraform), so
 *     NextAuth needs both client id and client secret.
 *   - The pool's Hosted UI domain (provisioned in Terraform) is what
 *     users actually see for signup / signin / verification — NextAuth
 *     redirects through it via the standard `code` OAuth flow.
 *
 * JWT session strategy: we don't need a database session table — the
 * Cognito sub is the stable id we key everything off (DDB user wallet
 * row, session ownership, etc.). JWTs encode that sub directly into
 * the auth cookie and the server reads it on every request.
 */

import NextAuth from 'next-auth';
import Cognito from 'next-auth/providers/cognito';

export const { handlers, signIn, signOut, auth } = NextAuth({
  /**
   * NextAuth v5 enforces a strict host check by default — incoming
   * requests must match `AUTH_URL` or be on a trusted hosting platform
   * (Vercel auto-detected). For our setup (local dev on localhost, then
   * AWS Amplify behind CloudFront in Phase 7) neither is automatic, so
   * we opt into trusting the host explicitly. Equivalent to setting
   * `AUTH_TRUST_HOST=true` in env, but encoded here so it can't be
   * forgotten on a fresh deploy.
   */
  trustHost: true,
  providers: [
    Cognito({
      clientId: process.env.COGNITO_CLIENT_ID,
      clientSecret: process.env.COGNITO_CLIENT_SECRET,
      issuer: process.env.COGNITO_ISSUER,
    }),
  ],
  pages: {
    // Custom signin page — replaces NextAuth's default `/api/auth/signin`
    // chooser. Our `/login` page calls `signIn('cognito')` directly.
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    /**
     * The first time a user signs in (`account` and `profile` are set),
     * we copy the Cognito `sub` and `email` from the OIDC profile onto
     * the JWT. Subsequent calls (token refresh, page loads) carry the
     * same sub/email through.
     */
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.sub = profile.sub as string;
        token.email = profile.email as string;
      }
      return token;
    },
    /**
     * Project the JWT claims onto the session shape the app sees via
     * `auth()`. `session.user.id` is the Cognito `sub` — the stable
     * primary key for everything user-scoped (wallet, session ownership).
     */
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
});
