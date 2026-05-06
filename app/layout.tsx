import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

import { Footer } from '@/components/Footer';
import { Navbar } from '@/components/Navbar';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'PayPhone — per-second video calls on Base',
  description:
    'Authorize up to $5 once; pay per-second over USDC on Base. Settled in one on-chain transfer at hangup.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      {/* `suppressHydrationWarning` on body: browser extensions like Kapture
          (and dark-mode autoswitchers, password managers, etc.) inject classes
          onto <body> before React hydrates, which would otherwise cause a
          hydration error in dev. The flag tells React to tolerate body-level
          class diffs without re-rendering — recommended by Next.js for this
          exact extension-mutation case. Doesn't affect production correctness;
          only suppresses the dev-only warning. */}
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        {/* Navbar self-skips on `/session/<id>` (immersive video page). */}
        <Navbar />
        {/* `flex-1` makes the page content area fill remaining vertical space
            so the footer sticks to the bottom on short pages. */}
        <div className="flex flex-1 flex-col">{children}</div>
        {/* Footer self-skips on `/session/*` (call + recap). */}
        <Footer />
      </body>
    </html>
  );
}
