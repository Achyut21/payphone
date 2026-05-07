# PayPhone screenshots

This directory holds the screenshots referenced from the project root `README.md`
and the `/docs` page. Until real captures land here, the README references
`https://placehold.co/...` URLs so it renders complete on submission day.

When you're ready to swap placeholders for real captures, follow the spec below
and replace the `placehold.co` URL in the README with `docs/screenshots/<filename>`.

## What to capture

| Filename                          | Page / state                                                                                              | Viewport | Notes                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `01-hero.png`                     | `/` — landing page hero with `BackgroundBeamsWithCollision`                                               | 1280×720 | Sign out before capture so the navbar shows "Get started" CTA, not the user pill.                              |
| `02-login.png`                    | `/login` — Cognito Hosted UI sign-in card with the Aceternity Spotlight background                       | 1280×720 | Capture the PayPhone-styled sign-in screen, not the Cognito-hosted page after redirect.                        |
| `03-marketplace.png`              | `/marketplace` — four expert cards in the lg-3-col grid, wallet panel above, network badge in navbar     | 1280×900 | Sign in as Achyut so the wallet shows a real balance.                                                          |
| `04-suggester.png`                | `/marketplace` — AI suggester input filled, "Suggested" badge tinted orange on Alice Chen's card         | 1280×900 | Type "I'm stuck on a Solidity gas optimization" and capture after Haiku 4.5 returns + scrolls to match.        |
| `05-session.png`                  | `/session/<id>` — live call, Daily iframe, ticker at ~$0.07 in the sidebar, ON AIR badge pulsing         | 1280×800 | Two-tab setup; capture the buyer's tab.                                                                        |
| `06-recap.png`                    | `/session/<id>/recap` — settle status card with green pulse + `$X.XX · m:ss`, AI summary streaming       | 1280×900 | Capture mid-stream so the streaming spinner shows next to the summary heading.                                 |
| `07-recap-chat.png`               | `/session/<id>/recap` — follow-up chat with one user bubble + one assistant bubble grounded in transcript | 1280×900 | Ask "what did we discuss?" and capture after the assistant replies.                                            |
| `08-docs.png`                     | `/docs` — animated architecture flowchart at full extent, with the milestones grid below                 | 1280×900 | Capture after all line-draw animations complete (≈2s after entering viewport).                                 |
| `09-mobile-marketplace.png`       | `/marketplace` at 375px wide — single-column, hamburger visible, wallet panel stacked above expert cards | 375×812  | Use Chrome DevTools "iPhone SE" preset.                                                                        |
| `10-mobile-session.png`           | `/session/<id>` at 375px — sticky `$X.XX` mini-bar at top, Daily iframe full-width below                 | 375×812  | Same DevTools preset; second tab simulates the expert.                                                         |
| `11-basescan-tx.png` *(optional)* | A BaseScan tab showing one of the M6 mainnet txes (warm-up or rehearsal)                                 | 1280×900 | Useful for the on-chain proof section if you want a concrete tx visible inline.                                |

## Conventions

- **Format:** `.png` for static UI, `.gif` for short interaction loops (3-5s, ≤2MB).
- **Filenames:** `kebab-case.png`. Prefix with `0X-` to keep ordering predictable in directory listings.
- **Crop:** browser chrome OK if it adds context; cut it if it doesn't.
- **Dark mode:** every screenshot should be in dark mode (the project's primary theme).
- **No personal data:** before capture, sign in as the demo Achyut account, not your personal email if you've used one.
