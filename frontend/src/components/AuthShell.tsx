import React from 'react';
import { Logo } from './ui';

/**
 * Split-screen frame shared by login, company registration and employee signup.
 * The left rail carries the product story so the form side stays uncluttered.
 */
export default function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
  aside,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
  aside?: { heading: string; points: string[] };
}) {
  const panel = aside || {
    heading: 'Account intelligence, written for the deal you are actually chasing.',
    points: [
      'Every report is scoped to your capabilities, your vertical and the solutions you pitch.',
      'Signals from news, filings and hiring are scored against your offer, not a generic template.',
      'Export a boardroom-ready PDF in a click.',
    ],
  };

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Brand rail */}
      <aside className="relative hidden w-[44%] max-w-[560px] flex-col justify-between overflow-hidden bg-navy-900 px-12 py-12 lg:flex">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #1d4ed8 0%, transparent 70%)' }}
        />

        <div className="relative">
          <Logo light />
        </div>

        <div className="relative">
          <h2 className="max-w-md text-[30px] font-extrabold leading-[1.2] tracking-tight text-white">
            {panel.heading}
          </h2>
          <ul className="mt-8 space-y-4">
            {panel.points.map((point) => (
              <li key={point} className="flex gap-3 text-[15px] leading-relaxed text-brand-100/80">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-200/50">
          © {new Date().getFullYear()} SalesMotion · B2B sales intelligence
        </p>
      </aside>

      {/* Form side */}
      <main className="flex flex-1 items-start justify-center overflow-y-auto px-5 py-10 sm:px-10">
        <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}>
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}

          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}
