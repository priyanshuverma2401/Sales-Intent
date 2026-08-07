import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Download,
  FileText,
  Layers,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { apiError, downloadReportPdf, reportsAPI } from '../services/api';
import AddAccountModal from '../components/AddAccountModal';
import { Alert, Button, EmptyState, PageHeader, ScoreRing, SkeletonRows, cx } from '../components/ui';

interface ReportSummary {
  _id: string;
  companyId: string;
  companyName: string;
  ticker?: string;
  status: 'pending' | 'complete' | 'failed';
  progress?: { step?: string; percent?: number };
  error?: string;
  score?: { value?: number; band?: string; summary?: string };
  context?: { sellerName?: string; priorityTopics?: string[]; topics?: string[] };
  fastFacts?: { industry?: string; headquarters?: string };
  generatedAt: string;
  pdfFileName?: string;
  // Reports are listed org-wide, so each row states who wrote it and whether
  // this viewer is allowed to remove it. The server decides both.
  author?: { _id: string; name: string; email: string } | null;
  isMine?: boolean;
  canDelete?: boolean;
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [query, setQuery] = useState('');
  const [authorId, setAuthorId] = useState('all');
  const [industry, setIndustry] = useState('all');

  // Typing must not fire a request per keystroke
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Dropdown options come from the whole visible history, not the filtered
  // page, so narrowing the list never removes the option you narrowed by.
  const [options, setOptions] = useState<{
    authors: { _id: string; name: string }[];
    industries: string[];
  }>({ authors: [], industries: [] });
  const [total, setTotal] = useState(0);

  const loadOptions = useCallback(async () => {
    try {
      const res = await reportsAPI.getReportFilters();
      setOptions({ authors: res.data.authors || [], industries: res.data.industries || [] });
    } catch (err) {
      // A missing filter list is not worth an error banner; the list still works
      setOptions({ authors: [], industries: [] });
    }
  }, []);

  const load = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const res = await reportsAPI.getReports({
          ...(search ? { q: search } : {}),
          ...(authorId !== 'all' ? { author: authorId } : {}),
          ...(industry !== 'all' ? { industry } : {}),
        });
        setReports(res.data);
        setTotal(Number(res.headers['x-total-count'] ?? res.data.length));
      } catch (err) {
        setMessage({ tone: 'error', text: apiError(err, 'Could not load reports') });
      } finally {
        setLoading(false);
      }
    },
    [search, authorId, industry]
  );

  // Refetches whenever a filter changes, because `load` depends on all three
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  // Reports generate asynchronously, so poll while any are still pending
  const hasPending = reports.some((r) => r.status === 'pending');
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => load(true), 5000);
    return () => clearInterval(timer);
  }, [hasPending, load]);

  const filtersActive = Boolean(query.trim()) || authorId !== 'all' || industry !== 'all';

  const clearFilters = () => {
    setQuery('');
    setAuthorId('all');
    setIndustry('all');
  };

  const download = async (report: ReportSummary) => {
    try {
      setBusyId(report._id);
      await downloadReportPdf(
        report._id,
        report.pdfFileName || `salesmotion-${report.companyName}.pdf`
      );
    } catch (err) {
      setMessage({ tone: 'error', text: 'Download failed — the PDF may still be rendering.' });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (report: ReportSummary) => {
    if (!window.confirm(`Delete the ${report.companyName} report?`)) return;
    try {
      setBusyId(report._id);
      await reportsAPI.remove(report._id);
      setReports((prev) => prev.filter((r) => r._id !== report._id));
      setTotal((prev) => Math.max(0, prev - 1));
      // That may have been the last report by an author or in an industry
      loadOptions();
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err, 'Could not delete the report') });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Intelligence"
        title="Reports"
        description="Every brief your team has generated, newest first."
        actions={
          <Button icon={Plus} onClick={() => setModalOpen(true)}>
            New report
          </Button>
        }
      />

      {message && (
        <div className="mb-5">
          <Alert tone={message.tone} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        </div>
      )}

      {/* Filters. Keyed off the unfiltered total so the bar - and the Clear
          button - survive a search that matches nothing. */}
      {total > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              className="input pl-9"
              placeholder="Search by company name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <select
            className="input w-auto min-w-[170px]"
            value={authorId}
            onChange={(e) => setAuthorId(e.target.value)}
            aria-label="Filter by who generated the report"
          >
            <option value="all">All researchers</option>
            {options.authors.map((a) => (
              <option key={a._id} value={a._id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            className="input w-auto min-w-[170px]"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            aria-label="Filter by industry"
            disabled={options.industries.length === 0}
          >
            <option value="all">All industries</option>
            {options.industries.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>

          {filtersActive && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold text-ink-muted transition hover:bg-slate-100 hover:text-ink"
            >
              <X size={14} /> Clear
            </button>
          )}

          <span className="ml-auto shrink-0 text-[13px] text-ink-muted">
            {filtersActive ? `${reports.length} of ${total}` : `${total} reports`}
          </span>
        </div>
      )}

      {loading ? (
        <SkeletonRows rows={3} />
      ) : reports.length === 0 && filtersActive ? (
        <EmptyState
          icon={Search}
          title="Nothing matches those filters"
          description="No report in your team matches what you are looking for."
          action={
            <Button variant="secondary" icon={X} onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No reports yet"
          description="Add an account and we will research it, score the fit and write the brief."
          action={
            <Button icon={Plus} onClick={() => setModalOpen(true)}>
              Create your first report
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {reports.map((report) => {
            const busy = busyId === report._id;
            const done = report.status === 'complete';

            return (
              <div
                key={report._id}
                className={cx(
                  'card flex flex-col overflow-hidden transition',
                  done && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-raised'
                )}
                onClick={() => done && navigate(`/reports/${report._id}`)}
              >
                <div className="flex-1 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-bold tracking-tight text-ink">
                          {report.companyName}
                        </h2>
                        {report.ticker && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-2xs font-semibold text-ink-muted">
                            {report.ticker}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                        {[report.fastFacts?.industry, report.fastFacts?.headquarters]
                          .filter(Boolean)
                          .join(' · ') || 'Account brief'}
                      </p>
                      {report.context?.sellerName && (
                        <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-ink-muted">
                          <Layers size={11} className="shrink-0 text-ink-faint" />
                          <span className="truncate font-medium">
                            Written for {report.context.sellerName}
                          </span>
                        </p>
                      )}
                      {report.author && !report.isMine && (
                        <p className="mt-1 truncate text-2xs text-ink-faint">
                          Researched by {report.author.name}
                        </p>
                      )}
                    </div>

                    {done && report.score?.value ? (
                      <ScoreRing value={report.score.value} size={52} />
                    ) : report.status === 'pending' ? (
                      <Loader2 size={18} className="mt-1 shrink-0 animate-spin text-brand-500" />
                    ) : (
                      <AlertTriangle size={18} className="mt-1 shrink-0 text-red-500" />
                    )}
                  </div>

                  {/* Lens — high-priority topics lead, so they are shown first */}
                  {report.context?.priorityTopics?.length || report.context?.topics?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(report.context.priorityTopics || []).slice(0, 3).map((topic) => (
                        <span
                          key={topic}
                          title="High priority"
                          className="rounded-md bg-emerald-50 px-2 py-0.5 text-2xs font-semibold text-emerald-700"
                        >
                          {topic}
                        </span>
                      ))}
                      {(report.context.topics || [])
                        .slice(0, Math.max(0, 3 - (report.context.priorityTopics?.length || 0)))
                        .map((topic) => (
                          <span
                            key={topic}
                            className="rounded-md bg-brand-50 px-2 py-0.5 text-2xs font-semibold text-brand-700"
                          >
                            {topic}
                          </span>
                        ))}
                    </div>
                  ) : null}

                  {done && report.score?.summary && (
                    <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-ink-soft">
                      {report.score.summary}
                    </p>
                  )}

                  {report.status === 'pending' && (
                    <div className="mt-4">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-brand-500 transition-all duration-700"
                          style={{ width: `${report.progress?.percent || 10}%` }}
                        />
                      </div>
                      <p className="mt-2 text-2xs font-medium text-ink-muted">
                        {report.progress?.step || 'Queued'}
                      </p>
                    </div>
                  )}

                  {report.status === 'failed' && (
                    <p className="mt-3 line-clamp-2 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">
                      {report.error || 'Generation failed'}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
                  <span className="text-2xs text-ink-faint">
                    {new Date(report.generatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>

                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {done && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Download}
                          loading={busy}
                          onClick={() => download(report)}
                        >
                          PDF
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/reports/${report._id}`)}
                        >
                          Open <ArrowRight size={13} />
                        </Button>
                      </>
                    )}
                    {report.status !== 'pending' && report.canDelete !== false && (
                      <button
                        onClick={() => remove(report)}
                        disabled={busy}
                        className="rounded-lg p-1.5 text-ink-faint transition hover:bg-red-50 hover:text-red-600"
                        title={report.isMine ? 'Delete report' : 'Delete report (owner)'}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddAccountModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={({ companyName, reportId, reportError }) => {
          load(true);
          loadOptions();
          if (reportError) {
            setMessage({ tone: 'error', text: `${companyName} added, but: ${reportError.error}` });
          } else if (reportId) {
            navigate(`/reports/${reportId}`);
          } else {
            setMessage({ tone: 'success', text: `${companyName} added.` });
          }
        }}
      />
    </div>
  );
}
