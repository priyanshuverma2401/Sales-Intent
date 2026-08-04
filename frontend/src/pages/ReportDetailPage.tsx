import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Download,
  ExternalLink,
  Loader2,
  Printer,
  RefreshCw,
  Sparkles,
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

function money(value?: number) {
  if (!value) return null;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString()}`;
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [activeChapter, setActiveChapter] = useState<string>(CHAPTERS[0].id);

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

  const sources = useMemo(() => report?.sources || [], [report]);

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
        <div className="border-b border-slate-100 bg-gradient-to-br from-white to-slate-50 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
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

              {facts.description && (
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-soft">
                  {facts.description.length > 420
                    ? `${facts.description.slice(0, 420).trim()}…`
                    : facts.description}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
                {facts.industry && (
                  <Fact label="Industry" value={facts.industry} />
                )}
                {facts.headquarters && <Fact label="Headquarters" value={facts.headquarters} />}
                {facts.employees ? (
                  <Fact label="Employees" value={Number(facts.employees).toLocaleString()} />
                ) : null}
                {facts.founded ? <Fact label="Founded" value={String(facts.founded)} /> : null}
                {facts.ticker && <Fact label="Ticker" value={facts.ticker} />}
                {money(facts.marketCap) && <Fact label="Market cap" value={money(facts.marketCap)!} />}
              </div>
            </div>

            {/* Score */}
            {report.score?.value ? (
              <div className="flex shrink-0 flex-col items-center rounded-xl border border-slate-200 bg-white px-6 py-5">
                <ScoreRing value={report.score.value} band={report.score.band} size={96} />
                <p className="mt-1 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  Salesmotion score
                </p>
              </div>
            ) : null}
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

            {report.quickLinks?.length ? (
              <>
                <h3 className="mb-2 mt-5 text-2xs font-bold uppercase tracking-[0.12em] text-ink-faint">
                  Quick links
                </h3>
                <ul className="space-y-1.5">
                  {report.quickLinks.map((link: any) => (
                    <li key={link.url}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-600 hover:text-brand-700"
                      >
                        {link.label}
                        <ExternalLink size={11} />
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="mr-1.5 text-2xs font-bold uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      <span className="font-medium text-ink-soft">{value}</span>
    </span>
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
