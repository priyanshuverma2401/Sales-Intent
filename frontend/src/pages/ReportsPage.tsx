import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Download,
  FileText,
  Loader2,
  Plus,
  Trash2,
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
  context?: { keywords?: string[]; vertical?: string };
  fastFacts?: { industry?: string; headquarters?: string };
  generatedAt: string;
  pdfFileName?: string;
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await reportsAPI.getReports();
      setReports(res.data);
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err, 'Could not load reports') });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reports generate asynchronously, so poll while any are still pending
  const hasPending = reports.some((r) => r.status === 'pending');
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => load(true), 5000);
    return () => clearInterval(timer);
  }, [hasPending, load]);

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
        description="Account briefs written through your capabilities and pitch keywords."
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

      {loading ? (
        <SkeletonRows rows={3} />
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
                    </div>

                    {done && report.score?.value ? (
                      <ScoreRing value={report.score.value} size={52} />
                    ) : report.status === 'pending' ? (
                      <Loader2 size={18} className="mt-1 shrink-0 animate-spin text-brand-500" />
                    ) : (
                      <AlertTriangle size={18} className="mt-1 shrink-0 text-red-500" />
                    )}
                  </div>

                  {/* Lens */}
                  {report.context?.keywords?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {report.context.keywords.slice(0, 3).map((k) => (
                        <span
                          key={k}
                          className="rounded-md bg-brand-50 px-2 py-0.5 text-2xs font-semibold text-brand-700"
                        >
                          {k}
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
                    {report.status !== 'pending' && (
                      <button
                        onClick={() => remove(report)}
                        disabled={busy}
                        className="rounded-lg p-1.5 text-ink-faint transition hover:bg-red-50 hover:text-red-600"
                        title="Delete report"
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
