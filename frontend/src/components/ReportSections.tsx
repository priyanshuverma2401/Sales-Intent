import React from 'react';
import { ExternalLink } from 'lucide-react';
import { cx } from './ui';

// Shared building blocks for the on-screen report. The visual language mirrors
// the exported PDF - coloured markers, footnote chips, quote cards - so a rep
// reading the web view recognises the document they send on.

export interface Insight {
  text: string;
  citations?: number[];
}

export interface Source {
  index: number;
  title: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  type?: string;
}

export const MARKER_COLORS = {
  brand: 'bg-brand-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  red: 'bg-red-500',
  purple: 'bg-violet-500',
  teal: 'bg-cyan-600',
  slate: 'bg-slate-400',
} as const;

export type MarkerTone = keyof typeof MARKER_COLORS;

export function Citations({
  citations,
  sources,
}: {
  citations?: number[];
  sources: Source[];
}) {
  if (!citations?.length) return null;

  const byIndex = new Map(sources.map((s) => [s.index, s]));

  return (
    <span className="ml-1.5 inline-flex flex-wrap gap-1 align-baseline">
      {citations.map((n) => {
        const source = byIndex.get(n);
        const label = `[${n}]`;

        // A citation with a resolvable URL opens the source; otherwise it still
        // points at the numbered entry in the Sources section.
        return source?.url ? (
          <a
            key={n}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.title}
            className="rounded bg-brand-50 px-1 text-[10px] font-bold text-brand-600 transition hover:bg-brand-100"
          >
            {label}
          </a>
        ) : (
          <a
            key={n}
            href="#sources"
            className="rounded bg-slate-100 px-1 text-[10px] font-bold text-ink-faint"
          >
            {label}
          </a>
        );
      })}
    </span>
  );
}

export function InsightList({
  items,
  sources,
  tone = 'brand',
  empty = 'No supporting evidence was found for this section.',
}: {
  items?: Insight[];
  sources: Source[];
  tone?: MarkerTone;
  empty?: string;
}) {
  if (!items?.length) {
    return <p className="text-[13px] italic text-ink-faint">{empty}</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 print-block">
          <span className={cx('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', MARKER_COLORS[tone])} />
          <p className="report-body min-w-0">
            {item.text}
            <Citations citations={item.citations} sources={sources} />
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ReportSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="card card-pad">
        <div className="mb-4 border-b border-slate-100 pb-3">
          <h2 className="text-[17px] font-bold tracking-tight text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function SubSection({
  title,
  tone = 'brand',
  children,
}: {
  title: string;
  tone?: MarkerTone;
  children: React.ReactNode;
}) {
  const textTone: Record<MarkerTone, string> = {
    brand: 'text-brand-700',
    amber: 'text-amber-700',
    green: 'text-emerald-700',
    red: 'text-red-700',
    purple: 'text-violet-700',
    teal: 'text-cyan-700',
    slate: 'text-ink-muted',
  };

  return (
    <div className="mb-6 last:mb-0">
      <h3
        className={cx(
          'mb-2.5 text-2xs font-bold uppercase tracking-[0.12em]',
          textTone[tone]
        )}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

export function QuoteCard({
  quote,
  person,
  title,
  source,
}: {
  quote: string;
  person?: string;
  title?: string;
  source?: string;
}) {
  return (
    <figure className="print-block rounded-lg border-l-[3px] border-brand-500 bg-slate-50 px-5 py-4">
      <blockquote className="text-[15px] italic leading-relaxed text-ink">“{quote}”</blockquote>
      <figcaption className="mt-2.5 text-[13px] text-ink-muted">
        — {[person, title, source].filter(Boolean).join(', ')}
      </figcaption>
    </figure>
  );
}

export function NewsList({ items, sources }: { items?: any[]; sources: Source[] }) {
  if (!items?.length) {
    return <p className="text-[13px] italic text-ink-faint">No recent coverage was found.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item, i) => (
        <li key={i} className="py-3 first:pt-0 last:pb-0 print-block">
          <div className="flex items-start gap-3">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-600" />
            <div className="min-w-0">
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-start gap-1.5 text-[14.5px] font-semibold leading-snug text-ink hover:text-brand-700"
                >
                  {item.title}
                  <ExternalLink
                    size={12}
                    className="mt-1 shrink-0 text-ink-faint group-hover:text-brand-600"
                  />
                </a>
              ) : (
                <p className="text-[14.5px] font-semibold leading-snug text-ink">{item.title}</p>
              )}

              {item.summary && (
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">{item.summary}</p>
              )}

              <p className="mt-1 text-2xs text-ink-faint">
                {[
                  item.source,
                  item.publishedAt ? new Date(item.publishedAt).toLocaleDateString() : null,
                ]
                  .filter(Boolean)
                  .join('  ·  ')}
                <Citations citations={item.citations} sources={sources} />
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SourcesList({ sources }: { sources: Source[] }) {
  if (!sources.length) {
    return <p className="text-[13px] italic text-ink-faint">No external sources were retrieved.</p>;
  }

  return (
    <ol className="space-y-2.5">
      {sources.map((source) => (
        <li key={source.index} className="flex gap-3 text-[13px]">
          <span className="w-7 shrink-0 font-bold text-brand-600">[{source.index}]</span>
          <div className="min-w-0">
            {source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-soft hover:text-brand-700 hover:underline"
              >
                {source.title}
              </a>
            ) : (
              <span className="text-ink-soft">{source.title}</span>
            )}
            <p className="mt-0.5 text-2xs text-ink-faint">
              {[
                source.source,
                source.publishedAt ? new Date(source.publishedAt).toLocaleDateString() : null,
                source.type,
              ]
                .filter(Boolean)
                .join('  ·  ')}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
