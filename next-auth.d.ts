/**
 * PayPhone — NextAuth type augmentation.
 *
 * NextAuth's default `Session.user` shape is `{ name?, email?, image? }`
 * — no `id`. We attach the Cognito `sub` to `session.user.id` in the
 * `session` callback in `auth.ts`, and code across the app reads it
 * (e.g. `getOrCreateUserWallet(session.user.id)`). This declaration
 * teaches TypeScript that the field is there so the callsites
 * type-check without `as` casts.
 *
 * Module-augmentation files don't need to be imported anywhere —
 * `tsconfig.json`'s `"include": [..., "next-auth.d.ts"]` (or the
 * default include patterns picking up `*.d.ts` at the root) is enough.
 */

import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      /** Cognito `sub` — the stable primary key per user. */
      id: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    /** Cognito `sub`, copied off the OIDC profile on first login. */
    sub?: string;
    /** Cognito email, copied off the OIDC profile on first login. */
    email?: string;
  }
}
