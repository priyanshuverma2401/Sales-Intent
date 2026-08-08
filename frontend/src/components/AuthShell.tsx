import React from 'react';
import { Check } from 'lucide-react';
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
    heading: 'Know exactly why each company needs what you sell.',
    points: [
      'Every report is written around what your company sells and who you sell to.',
      'We watch the news, hiring and announcements for each account, then tell you what matters.',
      'Share a polished PDF with your team or your customer in one click.',
    ],
  };

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Brand rail */}
      <aside className="relative hidden w-[46%] max-w-[600px] flex-col justify-between overflow-hidden bg-navy-900 px-12 py-12 lg:flex">
        {/* Slow-drifting colour behind the copy. Two blurred orbs plus a faint
            grid: enough depth that the panel reads as a product, not a swatch. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-[26rem] w-[26rem] animate-float rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 h-[26rem] w-[26rem] animate-float rounded-full opacity-25 blur-3xl"
          style={{
            background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)',
            animationDelay: '-3.5s',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              'linear-gradient(rgb(255 255 255 / 0.14) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.14) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(circle at 30% 30%, black, transparent 78%)',
            WebkitMaskImage: 'radial-gradient(circle at 30% 30%, black, transparent 78%)',
          }}
        />

        <div className="relative animate-fade-in-up">
          <Logo light />
        </div>

        <div className="relative">
          <h2 className="max-w-md animate-fade-in-up text-[34px] font-extrabold leading-[1.15] tracking-tighter text-white">
            {panel.heading}
          </h2>

          <ul className="mt-9 space-y-4">
            {panel.points.map((point, i) => (
              <li
                key={point}
                className="flex animate-fade-in-up gap-3 text-[15px] leading-relaxed text-brand-100/80"
                style={{ animationDelay: `${120 + i * 90}ms` }}
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/25 ring-1 ring-inset ring-brand-400/40">
                  <Check size={12} className="text-brand-200" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-200/50">
          © {new Date().getFullYear()} SalesMotion · Sales intelligence for B2B teams
        </p>
      </aside>

      {/* Form side */}
      <main className="page-wash flex flex-1 items-start justify-center overflow-y-auto px-5 py-12 sm:px-10">
        <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}>
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>

          <div className="animate-fade-in-up">
            <h1 className="text-[28px] font-extrabold leading-tight tracking-tighter text-ink">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{subtitle}</p>
            )}
          </div>

          <div className="mt-8 animate-fade-in-up" style={{ animationDelay: '90ms' }}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
