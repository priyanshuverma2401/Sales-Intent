import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  Download,
  Factory,
  Globe,
  Linkedin,
  Loader2,
  MapPin,
  Printer,
  RefreshCw,
  Sparkles,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import { apiError, downloadReportPdf, reportsAPI } from '../services/api';
import { Alert, Button, Card, ScoreRing, Spinner, cx } from '../components/ui';
import {
  InsightList,
  NewsList,
  QuoteCard,
  ReportSection,
  SourcesList,
  SubSection,
} from '../components/ReportSections';

// The report reads as one continuous document, the same order as the exported
// PDF. It used to be tabbed, which meant opening a report showed only the first
// of four panels - roughly a quarter of what the PDF held - and Print emitted
// just the active tab. These are jump links now, not tabs: everything is on the
// page and this is only a fast way down it.
const CHAPTERS = [
  {
    id: 'ch-brief',
    label: 'What You Need To Know',
    blurb: 'The brief you read in the five minutes before a call.',
  },
  {
    id: 'ch-research',
    label: 'Research & Analysis',
    blurb: 'How the account works, where it is heading, what stands in the way.',
  },
  { id: 'ch-value', label: 'Value', blurb: 'The argument you make in the room.' },
  { id: 'ch-sources', label: 'Sources', blurb: 'Every reference cited above.' },
] as const;

// Revenue is reported in whatever the company files in - a London bank in
// pounds, a Bengaluru one in rupees - so an amount is only readable next to the
// currency it was stated in. Market cap, which arrives from Finnhub in dollars,
// keeps the dollar default.
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  INR: '₹',
  KRW: '₩',
};

function money(value?: number, currency?: string) {
  if (!value) return null;

  const symbol = currency ? CURRENCY_SYMBOLS[currency] ?? `${currency} ` : '$';

  if (value >= 1e12) return `${symbol}${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${symbol}${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${symbol}${(value / 1e6).toFixed(1)}M`;
  return `${symbol}${value.toLocaleString()}`;
}

// Quick links are stored as plain label/url pairs, so the mark that belongs
// beside one has to be inferred from what it points at
function linkIcon(link: { label?: string; url?: string }) {
  const text = `${link.label || ''} ${link.url || ''}`.toLowerCase();
  if (text.includes('linkedin')) return Linkedin;
  if (text.includes('crunchbase')) return Building2;
  if (text.includes('finance.yahoo') || text.includes('yahoo finance')) return BarChart3;
  return Globe;
}

// "STAN on Yahoo Finance" is how the link is stored; the cover shows the ticker
function linkLabel(link: { label?: string }) {
  return String(link.label || '').replace(/\s+on\s+Yahoo Finance$/i, '');
}

function day(value: string | Date) {
  return new Date(value).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// A report can be regenerated more than once in a day, so the time is what
// makes "last refreshed" mean anything
function clock(value: string | Date) {
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [activeChapter, setActiveChapter] = useState<string>(CHAPTERS[0].id);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [descriptionClamped, setDescriptionClamped] = useState(false);
  const descriptionRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!id) return;
      try {
        if (!silent) setLoading(true);
        const res = await reportsAPI.getReport(id);
        setReport(res.data);
      } catch (err) {
        setError(apiError(err, 'Could not load this report'));
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Landing here straight after "Add account" means the report is still being
  // written, so keep polling until the pipeline finishes.
  useEffect(() => {
    if (report?.status !== 'pending') return;
    const timer = setInterval(() => load(true), 4000);
    return () => clearInterval(timer);
  }, [report?.status, load]);

  // Keeps the jump bar showing where you are on what is now a long page.
  useEffect(() => {
    if (report?.status !== 'complete') return;

    const targets = CHAPTERS.map((c) => document.getElementById(c.id)).filter(
      (el): el is HTMLElement => Boolean(el)
    );
    if (!targets.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveChapter(top.target.id);
      },
      { rootMargin: '-96px 0px -70% 0px' }
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [report?.status]);

  // "Show more" only earns its place when the text is genuinely cut off, and
  // whether it is depends on the column width - a short profile fits inside the
  // clamp on a wide screen and overflows it on a narrow one. So it is measured
  // rather than guessed at from a character count.
  useEffect(() => {
    if (descriptionOpen) return;

    const measure = () => {
      const el = descriptionRef.current;
      if (el) setDescriptionClamped(el.scrollHeight > el.clientHeight + 1);
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [report?.fastFacts?.description, report?.status, descriptionOpen]);

  const sources = useMemo(() => report?.sources || [], [report]);

  // The homepage belongs in Quick Links, and buildQuickLinks puts it there -
  // but only for accounts that had a website stored when the report ran. Any
  // report written before that carries the address in fastFacts and nowhere
  // else, so it is merged in here rather than left off the cover.
  const quickLinks = useMemo(() => {
    const links = [...(report?.quickLinks || [])];
    const website = report?.fastFacts?.website;
    if (!website) return links;

    const host = (url?: string) =>
      String(url || '')
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0]
        .toLowerCase();

    if (!links.some((link: any) => host(link.url) === host(website))) {
      links.unshift({ label: host(website), url: website });
    }

    return links;
  }, [report]);

  const download = async () => {
    if (!id) return;
    setDownloading(true);
    try {
      await downloadReportPdf(
        id,
        report?.pdfFileName || `salesmotion-${report?.companyName || 'report'}.pdf`
      );
    } catch (err) {
      setError('Download failed. The PDF may still be rendering — try again in a moment.');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <Spinner label="Loading report…" />;

  if (error && !report) {
    return (
      <div className="mx-auto max-w-xl">
        <Alert tone="error">{error}</Alert>
        <div className="mt-4">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/reports')}>
            Back to reports
          </Button>
        </div>
      </div>
    );
  }

  if (!report) return null;

  const facts = report.fastFacts || {};

  // 'Unknown' is the placeholder a company is stored with when no country was
  // resolved at the time it was added. It should read as absent rather than as
  // a place: "Headquartered in Unknown" is worse than no line at all.
  const headquarters = String(facts.headquarters || '')
    .split(',')
    .map((part: string) => part.trim())
    .filter((part: string) => part && part.toLowerCase() !== 'unknown')
    .join(', ');

  // Regenerating writes a fresh report rather than editing this one, so for any
  // given report the two are usually minutes apart - lastUpdatedAt is the moment
  // the pipeline finished writing it, and is absent only on reports that failed
  // part-way through.
  const lastRefreshed = report.lastUpdatedAt || report.generatedAt;

  const context = report.context || {};
  const brief = report.executiveBrief || {};
  const research = report.research || {};
  const value = report.value || {};

  // ------------------------------------------------------------------ states
  if (report.status === 'pending') {
    return (
      <div className="mx-auto max-w-2xl">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/reports')}>
          Back to reports
        </Button>

        <Card className="mt-4 p-10 text-center">
          <Loader2 size={28} className="mx-auto animate-spin text-brand-600" />
          <h1 className="mt-5 text-xl font-bold text-ink">
            Building your {report.companyName} report
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            Researching news, filings and hiring signals, then writing the analysis through your
            pitch lens{context.keywords?.length ? `: ${context.keywords.join(', ')}` : ''}.
          </p>

          <div className="mx-auto mt-7 max-w-sm">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-500 transition-all duration-700"
                style={{ width: `${report.progress?.percent || 10}%` }}
              />
            </div>
            <p className="mt-2.5 text-[13px] font-medium text-ink-muted">
              {report.progress?.step || 'Queued'}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  if (report.status === 'failed') {
    return (
      <div className="mx-auto max-w-2xl">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/reports')}>
          Back to reports
        </Button>

        <Card className="mt-4 p-10 text-center">
          <AlertTriangle size={28} className="mx-auto text-red-500" />
          <h1 className="mt-5 text-xl font-bold text-ink">Report generation failed</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            {report.error || 'Something went wrong while building this report.'}
          </p>
          <div className="mt-6">
            <Button
              icon={RefreshCw}
              onClick={async () => {
                try {
                  const res = await reportsAPI.generate(report.companyId);
                  navigate(`/reports/${res.data.reportId}`);
                } catch (err) {
                  setError(apiError(err, 'Could not restart the report'));
                }
              }}
            >
              Try again
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ------------------------------------------------------------------ report
  return (
    <div className="pb-10">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/reports')}>
          All reports
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={Printer} onClick={() => window.print()}>
            Print
          </Button>
          <Button size="sm" icon={Download} loading={downloading} onClick={download}>
            Export PDF
          </Button>
        </div>
      </div>

      {error && (
        <div className="no-print mb-4">
          <Alert tone="error" onDismiss={() => setError('')}>
            {error}
          </Alert>
        </div>
      )}

      {/* ---------------- Cover ---------------- */}
      <Card className="mb-5 overflow-hidden print-block">
        <div className="border-b border-slate-100 bg-gradient-to-br from-surface to-slate-50 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                {/* bg-white, not bg-surface: third-party logo art assumes a
                    white backing, and a dark-inked mark would disappear on a
                    dark card. */}
                {facts.logoUrl ? (
                  <img
                    src={facts.logoUrl}
                    alt=""
                    className="h-11 w-11 rounded-lg bg-white object-contain p-1 ring-1 ring-slate-200"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                  />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50">
                    <Building2 size={20} className="text-brand-600" />
                  </span>
                )}
                <div className="min-w-0">
                  <h1 className="truncate text-[28px] font-extrabold leading-tight tracking-tight text-ink">
                    {report.companyName}
                  </h1>
                  <p className="truncate text-sm text-ink-muted">
                    {facts.website
                      ? facts.website.replace(/^https?:\/\//, '').replace(/\/$/, '')
                      : facts.industry}
                  </p>
                </div>
              </div>
            </div>

            {/* Score */}
            {report.score?.value ? (
              <div className="flex shrink-0 flex-col items-center rounded-xl border border-slate-200 bg-surface px-6 py-5">
                <ScoreRing value={report.score.value} band={report.score.band} size={96} />
                <p className="mt-1 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  Salesmotion score
                </p>
              </div>
            ) : null}
          </div>

          {/* Fast Facts / Quick Links — the two columns of the cover. The facts
              read as sentences rather than labelled cells: "Headquartered in
              London, United Kingdom" is what a rep would say out loud. */}
          <div className="mt-7 grid gap-x-12 gap-y-7 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <h2 className="mb-3 text-lg font-bold tracking-tight text-ink">Fast Facts</h2>

              {facts.description && (
                <div className="max-w-2xl">
                  {/* Clamped by line count rather than cut at a character
                      count: the whole description stays in the DOM, so
                      expanding is instant and printing gets all of it however
                      it happened to be left on screen. */}
                  <p
                    ref={descriptionRef}
                    className={cx(
                      'text-sm leading-relaxed text-ink-soft print:line-clamp-none',
                      !descriptionOpen && 'line-clamp-6'
                    )}
                  >
                    {facts.description}
                  </p>
                  {(descriptionClamped || descriptionOpen) && (
                    <button
                      type="button"
                      onClick={() => setDescriptionOpen((open) => !open)}
                      className="no-print mt-1.5 text-[13px] font-semibold text-brand-600 hover:text-brand-700"
                    >
                      {descriptionOpen ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
              )}

              <ul className="mt-4 space-y-2.5">
                {headquarters && (
                  <FactRow icon={MapPin} value={`Headquartered in ${headquarters}`} />
                )}
                {facts.industry && <FactRow icon={Factory} value={facts.industry} />}
                {money(facts.revenue, facts.revenueCurrency) && (
                  <FactRow
                    icon={Banknote}
                    value={`${money(facts.revenue, facts.revenueCurrency)} revenue${
                      facts.revenueAsOf ? ` (FY${facts.revenueAsOf})` : ''
                    }`}
                  />
                )}
                {money(facts.marketCap) && (
                  <FactRow icon={TrendingUp} value={`${money(facts.marketCap)} market cap`} />
                )}
                {facts.founded ? (
                  <FactRow icon={CalendarDays} value={`Founded ${facts.founded}`} />
                ) : null}
              </ul>

              {report.score?.summary && (
                <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-soft">
                  {report.score.summary}
                </p>
              )}
            </div>

            <div>
              <h2 className="mb-3 text-lg font-bold tracking-tight text-ink">Quick Links</h2>

              <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                {facts.employees ? (
                  <FactRow
                    icon={Users}
                    value={`${Number(facts.employees).toLocaleString()} employees`}
                  />
                ) : null}
                {quickLinks.map((link: any) => (
                  <FactRow
                    key={link.url}
                    icon={linkIcon(link)}
                    value={linkLabel(link)}
                    href={link.url}
                  />
                ))}
              </ul>

              <h2 className="mb-3 mt-6 text-lg font-bold tracking-tight text-ink">
                Account Information
              </h2>
              <ul className="space-y-2.5">
                {report.accountAddedAt && (
                  <FactRow icon={CalendarClock} value={`Added ${day(report.accountAddedAt)}`} />
                )}
                {lastRefreshed && (
                  <FactRow
                    icon={RefreshCw}
                    value={`Last refreshed ${day(lastRefreshed)} at ${clock(lastRefreshed)}`}
                  />
                )}
                <FactRow icon={User} value={`Owner: ${report.author?.name || 'Salesmotion AI'}`} />
              </ul>
            </div>
          </div>
        </div>

        {/* Lens + score reasons */}
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h3 className="mb-2.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.12em] text-brand-600">
              <Sparkles size={13} /> Written for
            </h3>
            <dl className="space-y-2.5 text-[13px]">
              {context.sellerName && <ContextRow label="Seller" value={context.sellerName} />}
              {context.vertical && <ContextRow label="Vertical" value={context.vertical} />}
              {context.keywords?.length ? (
                <div className="flex gap-3">
                  <dt className="w-24 shrink-0 font-semibold text-ink-faint">Pitch focus</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {context.keywords.map((k: string) => (
                      <span
                        key={k}
                        className="rounded-md bg-brand-50 px-2 py-0.5 text-2xs font-semibold text-brand-700"
                      >
                        {k}
                      </span>
                    ))}
                  </dd>
                </div>
              ) : null}
              {context.verticalCapabilities?.length ? (
                <ContextRow
                  label="Capabilities"
                  value={context.verticalCapabilities.join(', ')}
                />
              ) : null}
            </dl>

            {report.score?.summary && (
              <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft">
                {report.score.summary}
              </p>
            )}
          </div>

          <div>
            <h3 className="mb-2.5 text-2xs font-bold uppercase tracking-[0.12em] text-ink-faint">
              Why this score
            </h3>
            <ul className="space-y-1.5">
              {(report.score?.reasons || []).map((reason: string, i: number) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink-soft">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {/* ---------------- Jump links ---------------- */}
      <div className="no-print sticky top-0 z-20 -mx-6 mb-5 border-b border-slate-200 bg-slate-50/90 px-6 backdrop-blur">
        <nav className="flex gap-1 overflow-x-auto scrollbar-none">
          {CHAPTERS.map((c) => (
            <a
              key={c.id}
              href={`#${c.id}`}
              className={cx(
                'whitespace-nowrap border-b-2 px-3.5 py-3 text-sm font-semibold transition',
                activeChapter === c.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-ink-muted hover:text-ink'
              )}
            >
              {c.label}
            </a>
          ))}
        </nav>
      </div>

      {/* ---------------- Report body ---------------- */}
      <div className="space-y-5">
        <Chapter {...CHAPTERS[0]} />

        <ReportSection
          id="key-insights"
          title="Key Insights"
          description="The developments that matter most for this pitch."
        >
          <InsightList items={brief.keyInsights} sources={sources} tone="amber" />
        </ReportSection>

        <div className="grid gap-5 lg:grid-cols-2">
          <ReportSection id="opportunities" title="Opportunities">
            <InsightList items={brief.opportunities} sources={sources} tone="green" />
          </ReportSection>

          <ReportSection id="challenges" title="Challenges">
            <InsightList items={brief.challenges} sources={sources} tone="red" />
          </ReportSection>
        </div>

        <ReportSection id="people" title="People Updates">
          <InsightList items={brief.peopleUpdates} sources={sources} tone="purple" />
        </ReportSection>

        <ReportSection id="news" title="Top News">
          <NewsList items={brief.topNews} sources={sources} />
        </ReportSection>

        <ReportSection
          id="talking-points"
          title="Talking Points"
          description="Openers you can say out loud on the first call."
        >
          <InsightList items={brief.talkingPoints} sources={sources} tone="brand" />
        </ReportSection>

        {brief.executivePerspective?.length ? (
          <ReportSection id="quotes" title="Executive Perspective">
            <div className="space-y-3">
              {brief.executivePerspective.map((q: any, i: number) => (
                <QuoteCard key={i} {...q} />
              ))}
            </div>
          </ReportSection>
        ) : null}

        <Chapter {...CHAPTERS[1]} />

        <ReportSection id="insights" title="Insights">
          <SubSection title="Company Overview">
            <InsightList items={research.companyOverview} sources={sources} />
          </SubSection>
          <SubSection title="Key People Changes" tone="purple">
            <InsightList items={research.keyPeopleChanges} sources={sources} tone="purple" />
          </SubSection>
          <SubSection title="Key Projects" tone="teal">
            <InsightList items={research.keyProjects} sources={sources} tone="teal" />
          </SubSection>
          <SubSection title="Aspirations">
            <InsightList items={research.aspirations} sources={sources} />
          </SubSection>
          <SubSection title="Business Goals">
            <InsightList items={research.businessGoals} sources={sources} />
          </SubSection>
          <SubSection title="Opportunities" tone="green">
            <InsightList items={research.opportunities} sources={sources} tone="green" />
          </SubSection>
          <SubSection title="Macroeconomic Perspective" tone="slate">
            <InsightList items={research.macroPerspective} sources={sources} tone="slate" />
          </SubSection>
          <SubSection title="Recent Press Announcements" tone="teal">
            <InsightList items={research.recentPress} sources={sources} tone="teal" />
          </SubSection>
        </ReportSection>

        <ReportSection id="business-model" title="Business Model">
          <SubSection title="Revenue Streams">
            <InsightList items={research.businessModel?.revenueStreams} sources={sources} />
          </SubSection>
          <SubSection title="Go-to-Market Strategy">
            <InsightList items={research.businessModel?.goToMarket} sources={sources} />
          </SubSection>
          <SubSection title="Ideal Customer Profile">
            <InsightList
              items={research.businessModel?.idealCustomerProfile}
              sources={sources}
            />
          </SubSection>
        </ReportSection>

        <div className="grid gap-5 lg:grid-cols-2">
          <ReportSection id="initiatives" title="Strategic Initiatives">
            <InsightList items={research.strategicInitiatives} sources={sources} />
          </ReportSection>
          <ReportSection id="financials" title="Financials">
            <InsightList items={research.financials} sources={sources} tone="teal" />
          </ReportSection>
        </div>

        <ReportSection
          id="swot"
          title="SWOT Analysis"
          description="Read from your angle: can this account buy, and what stands in the way?"
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <SubSection title="Strengths" tone="green">
              <InsightList items={research.swot?.strengths} sources={sources} tone="green" />
            </SubSection>
            <SubSection title="Weaknesses" tone="red">
              <InsightList items={research.swot?.weaknesses} sources={sources} tone="red" />
            </SubSection>
            <SubSection title="Opportunities" tone="brand">
              <InsightList items={research.swot?.opportunities} sources={sources} tone="brand" />
            </SubSection>
            <SubSection title="Threats" tone="amber">
              <InsightList items={research.swot?.threats} sources={sources} tone="amber" />
            </SubSection>
          </div>
        </ReportSection>

        <Chapter {...CHAPTERS[2]} />

        <ReportSection
          id="three-whys"
          title="Three Whys"
          description="The argument you make in the room."
        >
          <SubSection title="Why Change" tone="purple">
            <InsightList items={value.whyChange} sources={sources} tone="purple" />
          </SubSection>
          <SubSection title="Why Now" tone="amber">
            <InsightList items={value.whyNow} sources={sources} tone="amber" />
          </SubSection>
          <SubSection title="Why You" tone="green">
            <InsightList items={value.whyYou} sources={sources} tone="green" />
          </SubSection>
        </ReportSection>

        <ReportSection id="value-pyramid" title="Value Pyramid">
          <SubSection title="Company Goals">
            <InsightList items={value.valuePyramid?.companyGoals} sources={sources} />
          </SubSection>
          <SubSection title="Business Strategy">
            <InsightList items={value.valuePyramid?.businessStrategy} sources={sources} />
          </SubSection>
          <SubSection title="Challenges and Obstacles" tone="red">
            <InsightList
              items={value.valuePyramid?.challengesObstacles}
              sources={sources}
              tone="red"
            />
          </SubSection>
          <SubSection title="Value Paths" tone="teal">
            <InsightList items={value.valuePyramid?.valuePaths} sources={sources} tone="teal" />
          </SubSection>
        </ReportSection>

        {value.valuePropositions?.length ? (
          <ReportSection
            id="value-props"
            title="Value Proposition Ideas"
            description="Ready to lift into a deck or an email."
          >
            <div className="space-y-4">
              {value.valuePropositions.map((prop: any, i: number) => (
                <div
                  key={i}
                  className="print-block rounded-lg border border-slate-200 bg-slate-50/60 p-4"
                >
                  <h4 className="mb-1.5 text-sm font-bold text-ink">
                    <span className="mr-2 text-brand-600">{i + 1}.</span>
                    {prop.title}
                  </h4>
                  <p className="report-body">{prop.body}</p>
                </div>
              ))}
            </div>
          </ReportSection>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <ReportSection
            id="hypotheses"
            title="Value Hypothesis"
            description="Bets to test on the call."
          >
            <InsightList items={value.hypotheses} sources={sources} tone="purple" />
          </ReportSection>

          <ReportSection id="pov" title="Point of View">
            <InsightList items={value.pointOfView} sources={sources} tone="brand" />
          </ReportSection>
        </div>

        <Chapter {...CHAPTERS[3]} />

        <ReportSection
          id="sources"
          title="Sources"
          description={`${sources.length} references gathered for this report.`}
        >
          <SourcesList sources={sources} />
        </ReportSection>
      </div>

      <footer className="no-print mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 text-[13px] text-ink-muted">
        <span>
          Generated {new Date(report.generatedAt).toLocaleString()}
          {report.aiModel ? ` · ${report.aiModel}` : ''}
        </span>
        <Link to="/accounts" className="font-semibold text-brand-600 hover:underline">
          Back to accounts
        </Link>
      </footer>
    </div>
  );
}

// Divider between the four parts of the document. Gives the long scroll an
// obvious structure, and gives the jump links something to anchor to.
function Chapter({ id, label, blurb }: { id: string; label: string; blurb?: string }) {
  return (
    <div id={id} className="scroll-mt-16 pt-4 first:pt-0 print-block">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-slate-300 pb-2">
        <h2 className="text-xl font-extrabold tracking-tight text-ink">{label}</h2>
        {blurb && <p className="text-[13px] text-ink-muted">{blurb}</p>}
      </div>
    </div>
  );
}

/** One line of the cover: a mark, then the fact itself or the link it points at. */
function FactRow({
  icon: Icon,
  value,
  href,
}: {
  icon: React.ElementType;
  value: string;
  href?: string;
}) {
  return (
    <li className="flex items-start gap-2.5 text-[13.5px] leading-snug">
      <Icon size={15} className="mt-0.5 shrink-0 text-brand-600" />
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 break-words font-medium text-brand-600 underline-offset-2 hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="min-w-0 break-words text-ink-soft">{value}</span>
      )}
    </li>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 font-semibold text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-ink-soft">{value}</dd>
    </div>
  );
}
