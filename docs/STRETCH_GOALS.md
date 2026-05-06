# PayPhone — Stretch Goals

Items below are explicitly **out of scope** for the locked build plan.
**Do NOT build any of these unless the user explicitly says "build stretch goal #N".**

They are listed so we don't lose track of them, not so they get implemented.

---

1. **AWS Cognito real authentication**
   Replace seeded fake login with Cognito User Pools. Adds 3rd AWS service for the criterion. Time estimate: 3–5 hours. Risk: known time sink in App Router.

2. **AI suggests an expert**
   A chat bar at the top of the marketplace where the user describes their problem and Haiku recommends one of the seeded experts. ~1 hour.

3. **AI summary email via AWS SES**
   After the call settles, send the user an email with the meeting summary. ~1.5 hours including SES verification.

4. **Editable expert profiles**
   Replace seed data with admin-editable expert records in DynamoDB. Adds an admin panel. ~3 hours.

5. **Multiple concurrent demo sessions**
   Currently the architecture supports only one active session at a time per buyer wallet (Permit2 nonce). Lifting this would need either multiple buyer wallets or true unordered nonce handling. ~2 hours.

6. **Public "try it yourself" demo**
   A pre-funded throwaway buyer wallet visitors can use to actually run a real session in their browser. Requires careful spend caps. ~3 hours.

7. **Curated stock-photo avatars**
   Replace DiceBear-generated avatars on expert cards with real-looking faces. ~30 min plus image rights.

8. **Migration to AWS Amplify Hosting**
   ~~This was a stretch goal until we re-locked Amplify as the primary host. Removed.~~

---

## Note on Vercel

Vercel is the **fallback** if Amplify Hosting fails — not a stretch goal. If you find yourself reaching for Vercel mid-build, stop and ask the user whether the Amplify failure is real or transient.
