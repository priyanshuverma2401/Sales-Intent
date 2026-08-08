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

// Talking points carry more than a claim - see the note on the Mongo schema.
// Every field but `text` is optional: reports generated before this shape
// existed hold a plain insight and still render as a body-only point.
export interface TalkingPoint extends Insight {
  headline?: string;
  question?: string;
  proof?: string;
  objection?: string;
}

export interface Source {
  index: number;
  title: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  type?: string;
  // Why this source is in the report, from a fixed vocabulary set server-side.
  // Shown in the reference list and on hovering a citation chip.
  reason?: string;
  originalPublisher?: string;
}

// Kept in step with CITATION_REASONS in the backend's intelligenceService. A
// reason the server sends that is missing here falls back to the raw value
// rather than disappearing.
export const CITATION_REASONS: Record<string, string> = {
  financial: 'Financial snapshot',
  earnings: 'Reported results',
  filing: 'Regulatory filing',
  transcript: 'Earnings call',
  program: 'Strategic programme',
  regulatory: 'Regulatory action',
  people: 'Leadership change',
  hiring: 'Hiring activity',
  job: 'Open role',
  patent: 'Patent record',
  contract: 'Federal contract',
  partnership: 'Partnership / deal',
  restructuring: 'Restructuring',
  news: 'News coverage',
};

export function reasonLabel(source?: Source) {
  if (!source?.reason) return source?.type || '';
  return CITATION_REASONS[source.reason] || source.reason;
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
        // The reason rides on the tooltip rather than beside the chip: inline
        // it would double the length of every claim for a reader who mostly
        // wants to know a claim is sourced at all.
        const reason = reasonLabel(source);
        const hint = [source?.title, reason].filter(Boolean).join(' — ');

        // A citation with a resolvable URL opens the source; otherwise it still
        // points at the numbered entry in the Sources section.
        return source?.url ? (
          <a
            key={n}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={hint}
            className="rounded bg-brand-50 px-1 text-[10px] font-bold text-brand-600 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-100"
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
  empty = 'We could not find anything solid to say here yet.',
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

// One cue under a talking point: what to ask, what to prove it with, what to
// say when it is pushed back on.
function Cue({ label, text, tone }: { label: string; text?: string; tone: string }) {
  if (!text) return null;

  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <span
        className={cx(
          'shrink-0 pt-[3px] text-2xs font-bold uppercase tracking-[0.12em] sm:w-32',
          tone
        )}
      >
        {label}
      </span>
      <p className="min-w-0 text-[13.5px] leading-relaxed text-ink-soft">{text}</p>
    </div>
  );
}

export function TalkingPointList({
  items,
  sources,
}: {
  items?: TalkingPoint[];
  sources: Source[];
}) {
  if (!items?.length) {
    return (
      <p className="text-[13px] italic text-ink-faint">
        We could not find anything solid to say here yet.
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {items.map((item, i) => (
        <li
          key={i}
          className="print-block rounded-xl border border-slate-200 bg-surface-2 px-4 py-3.5 transition duration-200 ease-swift hover:border-brand-200 hover:shadow-card"
        >
          <div className="flex gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-[11px] font-bold text-white shadow-sm">
              {i + 1}
            </span>

            <div className="min-w-0 flex-1">
              {item.headline && (
                <h4 className="text-[14.5px] font-semibold leading-snug text-ink">
                  {item.headline}
                </h4>
              )}

              <p className={cx('report-body', item.headline && 'mt-1')}>
                {item.text}
                <Citations citations={item.citations} sources={sources} />
              </p>

              {(item.question || item.proof || item.objection) && (
                <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                  <Cue label="Ask them" text={item.question} tone="text-brand-700" />
                  <Cue label="Back it up with" text={item.proof} tone="text-emerald-700" />
                  <Cue label="If they push back" text={item.objection} tone="text-amber-700" />
                </div>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
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
      <div className="card card-pad hover:shadow-raised">
        <div className="mb-4 border-b border-slate-100 pb-3">
          <h2 className="text-[17px] font-bold tracking-tighter text-ink">{title}</h2>
          {description && (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>
          )}
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
    <figure className="print-block rounded-xl border-l-[3px] border-brand-500 bg-surface-2 px-5 py-4 ring-1 ring-inset ring-slate-200/60">
      <blockquote className="text-[15px] italic leading-relaxed text-ink">“{quote}”</blockquote>
      <figcaption className="mt-2.5 text-[13px] text-ink-muted">
        — {[person, title, source].filter(Boolean).join(', ')}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Verified record blocks
//
// Every line these render came out of a filing, a job board, a public register
// or a dated article, extracted server-side in code. None of it passed through
// the model, which is why these lines can carry a name and a figure.
//
// Each block renders null when it holds nothing. An absent block is the honest
// answer - the alternative is five "none found" rows on most reports.
// ---------------------------------------------------------------------------

const monthYear = (value?: string | Date) =>
  value
    ? new Date(value).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

const money = (value?: number) => {
  if (!Number.isFinite(Number(value))) return '';
  const n = Number(value);
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
};

const TONE_BAR: Record<MarkerTone, string> = {
  brand: 'border-brand-500',
  amber: 'border-amber-500',
  green: 'border-emerald-500',
  red: 'border-red-500',
  purple: 'border-violet-500',
  teal: 'border-cyan-600',
  slate: 'border-slate-400',
};

const TONE_TEXT: Record<MarkerTone, string> = {
  brand: 'text-brand-700',
  amber: 'text-amber-700',
  green: 'text-emerald-700',
  red: 'text-red-700',
  purple: 'text-violet-700',
  teal: 'text-cyan-700',
  slate: 'text-ink-muted',
};

/** A labelled run of verified records, set off from the written insights. */
export function RecordBlock({
  label,
  tone = 'brand',
  children,
}: {
  label: string;
  tone?: MarkerTone;
  children: React.ReactNode;
}) {
  return (
    <div className={cx('mb-4 border-l-2 pl-3.5 print-block', TONE_BAR[tone])}>
      <h4
        className={cx(
          'mb-2 text-2xs font-bold uppercase tracking-[0.12em]',
          TONE_TEXT[tone]
        )}
      >
        {label}
      </h4>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

/** One record: a bold lead, a muted detail line, citations on the end. */
export function RecordLine({
  lead,
  detail,
  url,
  citations,
  sources,
}: {
  lead: string;
  detail?: string;
  url?: string;
  citations?: number[];
  sources: Source[];
}) {
  if (!lead) return null;

  return (
    <div className="print-block">
      <p className="text-[14px] font-semibold leading-snug text-ink">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-brand-700 hover:underline"
          >
            {lead}
          </a>
        ) : (
          lead
        )}
      </p>
      {detail && (
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">
          {detail}
          <Citations citations={citations} sources={sources} />
        </p>
      )}
      {!detail && <Citations citations={citations} sources={sources} />}
    </div>
  );
}

/**
 * Said on the face of the report rather than left for the reader to infer.
 *
 * A report written on nine sources and one written on forty format identically,
 * and the thin one reads exactly as confident as the thorough one.
 */
export function CoverageWarning({ coverage }: { coverage?: any }) {
  if (!coverage?.thin || !coverage.warning) return null;

  return (
    <div className="print-block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-[13px] font-semibold text-amber-900">Thin coverage</p>
      <p className="mt-1 text-[13px] leading-relaxed text-amber-800">{coverage.warning}</p>
    </div>
  );
}

export function ProgramBlock({ programs, sources }: { programs?: any[]; sources: Source[] }) {
  const list = (programs || []).filter((p) => p?.name);
  if (!list.length) return null;

  return (
    <RecordBlock label="Named programmes" tone="purple">
      {list.slice(0, 4).map((program, i) => (
        <RecordLine
          key={i}
          lead={[program.name, program.headlineNumber].filter(Boolean).join(' — ')}
          detail={[
            program.announcedAt ? `Announced ${monthYear(program.announcedAt)}` : null,
            program.summary,
          ]
            .filter(Boolean)
            .join('. ')}
          url={program.url}
          citations={program.citations}
          sources={sources}
        />
      ))}
    </RecordBlock>
  );
}

const REGULATORY_LABELS: Record<string, string> = {
  fine: 'Fine',
  enforcement: 'Enforcement action',
  licence: 'Licence action',
  'stress-test': 'Capital / stress-test requirement',
  deadline: 'Compliance deadline',
  advisory: 'Advisory',
};

export function RegulatoryBlock({ actions, sources }: { actions?: any[]; sources: Source[] }) {
  const list = (actions || []).filter((a) => a?.regulator);
  if (!list.length) return null;

  return (
    <RecordBlock label="Regulatory triggers" tone="red">
      {list.slice(0, 4).map((action, i) => (
        <RecordLine
          key={i}
          lead={[
            `${action.regulator} — ${REGULATORY_LABELS[action.actionType] || action.actionType}`,
            action.amount,
          ]
            .filter(Boolean)
            .join(' · ')}
          detail={[monthYear(action.announcedAt), action.detail].filter(Boolean).join(' · ')}
          url={action.url}
          citations={action.citations}
          sources={sources}
        />
      ))}
    </RecordBlock>
  );
}

export function ResultsBlock({ results, sources }: { results?: any; sources: Source[] }) {
  if (!results) return null;

  const parts = [
    results.revenue ? `${money(results.revenue)} revenue` : null,
    results.profit ? `${money(results.profit)} profit` : null,
    Number.isFinite(results.eps) ? `EPS ${Number(results.eps).toFixed(2)}` : null,
    results.buybackAmount ? `${money(results.buybackAmount)} buybacks` : results.buyback || null,
    Number.isFinite(results.dividendPerShare)
      ? `dividend ${Number(results.dividendPerShare).toFixed(2)}/share`
      : null,
  ].filter(Boolean);

  if (!parts.length) return null;

  return (
    <RecordBlock label="Latest results" tone="teal">
      <RecordLine
        lead={`${results.period || 'Latest period'}: ${parts.join(', ')}`}
        detail={[
          results.lastEarningsAt
            ? `Reported ${new Date(results.lastEarningsAt).toLocaleDateString()}`
            : null,
          results.source,
        ]
          .filter(Boolean)
          .join('  ·  ')}
        url={results.url}
        citations={results.citations}
        sources={sources}
      />
    </RecordBlock>
  );
}

export function HiringBlock({ hiring, sources }: { hiring?: any; sources: Source[] }) {
  if (!hiring?.summary) return null;

  return (
    <RecordBlock label="Hiring signal" tone="green">
      <RecordLine
        lead={hiring.summary}
        detail={[
          (hiring.byFunction || [])
            .slice(0, 4)
            .map((f: any) => `${f.name} ${f.count}`)
            .join('  ·  '),
          hiring.source,
        ]
          .filter(Boolean)
          .join('  —  ')}
        citations={hiring.citations}
        sources={sources}
      />
    </RecordBlock>
  );
}

/**
 * Executive moves, newest first.
 *
 * The one block that speaks when it is empty. "No specific executives
 * mentioned" reads as a broken product; this states the window that was
 * searched and stops there.
 */
export function PeopleBlock({ moves, sources }: { moves?: any[]; sources: Source[] }) {
  const list = (moves || []).filter((m) => m?.person);

  if (!list.length) {
    return (
      <p className="text-[13.5px] leading-relaxed text-ink-soft">
        No verified executive moves in the last 90 days.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {list.slice(0, 6).map((move, i) => {
        const context = [
          monthYear(move.announcedAt),
          move.counterparty
            ? move.movement === 'left'
              ? `now at ${move.counterparty}`
              : `ex-${move.counterparty}`
            : null,
        ]
          .filter(Boolean)
          .join(', ');

        const head =
          move.movement === 'left'
            ? `${move.person} — stepped down${move.role ? ` as ${move.role}` : ''}`
            : `${move.person} — ${move.movement === 'promoted' ? 'promoted to ' : ''}${move.role}`;

        return (
          <RecordLine
            key={i}
            lead={context ? `${head} (${context})` : head}
            detail={move.source}
            url={move.url}
            citations={move.citations}
            sources={sources}
          />
        );
      })}
    </div>
  );
}

export function ContractBlock({
  awards,
  sources,
  compact = false,
}: {
  awards?: any[];
  sources: Source[];
  compact?: boolean;
}) {
  const list = (awards || []).filter((a) => a?.agency || a?.awardId);
  if (!list.length) return null;

  return (
    <RecordBlock label="Federal contract awards" tone="brand">
      {list.slice(0, compact ? 2 : 6).map((award, i) => (
        <RecordLine
          key={i}
          lead={[money(award.amount) || 'Undisclosed', award.agency].filter(Boolean).join(' — ') +
            (award.startedAt ? ` (${monthYear(award.startedAt)})` : '')}
          detail={
            compact
              ? award.awardId
                ? `Award ${award.awardId}`
                : undefined
              : [award.awardId ? `Award ${award.awardId}` : null, award.description]
                  .filter(Boolean)
                  .join(' — ')
          }
          url={award.url}
          citations={award.citations}
          sources={sources}
        />
      ))}
    </RecordBlock>
  );
}

export function PatentBlock({ patents, sources }: { patents?: any[]; sources: Source[] }) {
  const list = (patents || []).filter((p) => p?.title);
  if (!list.length) return null;

  return (
    <RecordBlock label="Patent activity" tone="teal">
      {list.slice(0, 6).map((patent, i) => (
        <RecordLine
          key={i}
          lead={patent.title}
          detail={[
            `${patent.status === 'granted' ? 'Granted' : 'Filed'} ${monthYear(
              patent.grantedAt || patent.filedAt
            )}`.trim(),
            patent.patentNumber,
            patent.applicant,
          ]
            .filter(Boolean)
            .join('  ·  ')}
          url={patent.url}
          citations={patent.citations}
          sources={sources}
        />
      ))}
    </RecordBlock>
  );
}

export function NewsList({ items, sources }: { items?: any[]; sources: Source[] }) {
  if (!items?.length) {
    return (
      <p className="text-[13px] italic text-ink-faint">We did not find any recent coverage.</p>
    );
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
    return (
      <p className="text-[13px] italic text-ink-faint">
        We did not pull in any outside sources for this one.
      </p>
    );
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
                reasonLabel(source),
                source.originalPublisher ? `originally ${source.originalPublisher}` : null,
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
