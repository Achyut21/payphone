'use client';
import { cn } from '@/lib/utils';
import React, { ReactNode } from 'react';

/**
 * Aceternity Aurora background — modified for PayPhone M4.5.
 *
 * Changes from the upstream Aceternity component:
 *   - Outer wrapper changed from `<main>` to `<div>` so callers can keep
 *     using their own `<main>` element without nesting (invalid HTML).
 *   - Default `h-[100vh]` removed; the wrapper now sizes to its content.
 *     Pass `min-h-screen` (or similar) via className when full-viewport
 *     coverage is wanted.
 *   - Default background color changed from `bg-zinc-50 dark:bg-zinc-900`
 *     to `bg-payphone-bg` (#0a0a0a) so the aurora haze blends into the
 *     M4.5 dark palette without an intermediate zinc shade.
 *   - Aurora gradient color stops swapped to payphone-blue (`#0052FF`),
 *     a payphone-blue tint (`#6699FF`), a payphone-orange tint (`#FFB89A`),
 *     and payphone-orange (`#FF6B35`). The mix-blend / invert chain is
 *     preserved so the visual feel — soft haze in dark mode — survives.
 *
 * The original component's apologia ("I'm sorry but this is what peak
 * developer performance looks like") is preserved out of respect.
 */

interface AuroraBackgroundProps extends React.HTMLProps<HTMLDivElement> {
  children: ReactNode;
  showRadialGradient?: boolean;
}

export const AuroraBackground = ({
  className,
  children,
  showRadialGradient = true,
  ...props
}: AuroraBackgroundProps) => {
  return (
    <div
      className={cn(
        'transition-bg relative flex flex-col items-center justify-center bg-payphone-bg text-payphone-ink',
        className,
      )}
      {...props}
    >
      <div
        className="absolute inset-0 overflow-hidden"
        style={
          {
            '--aurora':
              'repeating-linear-gradient(100deg,#0052FF_10%,#FFB89A_15%,#6699FF_20%,#FFD4BB_25%,#FF6B35_30%)',
            '--dark-gradient':
              'repeating-linear-gradient(100deg,#000_0%,#000_7%,transparent_10%,transparent_12%,#000_16%)',
            '--white-gradient':
              'repeating-linear-gradient(100deg,#fff_0%,#fff_7%,transparent_10%,transparent_12%,#fff_16%)',

            '--blue-300': '#A8C5FF',
            '--blue-400': '#6699FF',
            '--blue-500': '#0052FF',
            '--indigo-300': '#FFB89A',
            '--violet-200': '#FFD4BB',
            '--orange-500': '#FF6B35',
            '--black': '#000',
            '--white': '#fff',
            '--transparent': 'transparent',
          } as React.CSSProperties
        }
      >
        <div
          //   I'm sorry but this is what peak developer performance looks like // trigger warning
          className={cn(
            `after:animate-aurora pointer-events-none absolute -inset-[10px] [background-image:var(--white-gradient),var(--aurora)] [background-size:300%,_200%] [background-position:50%_50%,50%_50%] opacity-50 blur-[10px] invert filter will-change-transform [--aurora:repeating-linear-gradient(100deg,var(--blue-500)_10%,var(--indigo-300)_15%,var(--blue-300)_20%,var(--violet-200)_25%,var(--orange-500)_30%)] [--dark-gradient:repeating-linear-gradient(100deg,var(--black)_0%,var(--black)_7%,var(--transparent)_10%,var(--transparent)_12%,var(--black)_16%)] [--white-gradient:repeating-linear-gradient(100deg,var(--white)_0%,var(--white)_7%,var(--transparent)_10%,var(--transparent)_12%,var(--white)_16%)] after:absolute after:inset-0 after:[background-image:var(--white-gradient),var(--aurora)] after:[background-size:200%,_100%] after:[background-attachment:fixed] after:mix-blend-difference after:content-[""] dark:[background-image:var(--dark-gradient),var(--aurora)] dark:invert-0 after:dark:[background-image:var(--dark-gradient),var(--aurora)]`,

            showRadialGradient &&
              `[mask-image:radial-gradient(ellipse_at_100%_0%,black_10%,var(--transparent)_70%)]`,
          )}
        ></div>
      </div>
      {children}
    </div>
  );
};
