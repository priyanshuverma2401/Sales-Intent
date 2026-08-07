import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  Building2,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { accountsAPI, reportsAPI, signalsAPI } from '../services/api';
import { useAuthStore, companyProfileIncomplete, focusTopics } from '../store/authStore';
import AddAccountModal from '../components/AddAccountModal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  ScoreRing,
  SkeletonRows,
  cx,
} from '../components/ui';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, organization } = useAuthStore();

  const [accounts, setAccounts] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const [a, r, s] = await Promise.allSettled([
      accountsAPI.getAccounts(),
      reportsAPI.getReports(),
      signalsAPI.getSignals(7),
    ]);
    if (a.status === 'fulfilled') setAccounts(a.value.data);
    if (r.status === 'fulfilled') setReports(r.value.data);
    if (s.status === 'fulfilled') setSignals(s.value.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const { high: priorityTopics, rest: otherTopics, all: allTopics } = focusTopics(organization);
  const incomplete = companyProfileIncomplete(organization);
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  // Priority topics are what the report is argued around; without any, every
  // monitored topic counts equally.
  const lens = priorityTopics.length ? priorityTopics : allTopics;

  // The board a rep actually wants: their highest-scoring accounts first
  const ranked = useMemo(
    () =>
      [...accounts]
        .filter((a) => a.latestReport?.score)
        .sort((a, b) => (b.latestReport?.score || 0) - (a.latestReport?.score || 0))
        .slice(0, 5),
    [accounts]
  );

  const priorityCount = accounts.filter((a) => (a.latestReport?.score || 0) >= 70).length;
  const pendingCount = reports.filter((r) => r.status === 'pending').length;

  return (
    <div>
      <PageHeader
        eyebrow={organization?.name}
        title={`Good to see you, ${user?.firstName || 'there'}`}
        description={
          lens.length
            ? `Every account below is read for where they need ${lens.join(' and ')}.`
            : 'Add relevant topics to the company profile so we can tell you which accounts need what you sell.'
        }
        actions={
          <Button icon={Plus} onClick={() => setModalOpen(true)}>
            Add account
          </Button>
        }
      />

      {/* Company profile nudge. Only owners and admins can act on it. */}
      {incomplete && (
        <Card className="mb-6 border-brand-200 bg-gradient-to-br from-brand-50 to-surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600">
                <Target size={19} className="text-white" />
              </span>
              <div>
                <h2 className="text-base font-bold text-ink">Complete your company profile</h2>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-soft">
                  What your company sells and the topics it monitors decide what every report
                  focuses on — and topics marked high priority lead the analysis.
                  {!isAdmin && ' Only an owner or admin can fill this in.'}
                </p>
              </div>
            </div>
            {isAdmin && (
              <Button onClick={() => navigate('/settings')}>
                Complete setup <ArrowRight size={15} />
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Accounts tracked"
          value={accounts.length}
          icon={Building2}
          tone="brand"
          to="/accounts"
        />
        <Stat
          label="Priority fits"
          value={priorityCount}
          hint="Score 70+"
          icon={TrendingUp}
          tone="green"
          to="/accounts"
        />
        <Stat
          label="Reports"
          value={reports.length}
          hint={pendingCount ? `${pendingCount} generating` : undefined}
          icon={FileText}
          tone="purple"
          to="/reports"
        />
        <Stat
          label="Signals this week"
          value={signals.length}
          icon={Bell}
          tone="amber"
          to="/signals"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* Ranked accounts */}
        <div>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-ink">Best-fit accounts</h2>
              <p className="text-[13px] text-ink-muted">Ranked by Salesmotion score.</p>
            </div>
            <Link
              to="/accounts"
              className="text-[13px] font-semibold text-brand-600 hover:text-brand-700"
            >
              View all
            </Link>
          </div>

          {loading ? (
            <SkeletonRows rows={3} />
          ) : ranked.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={accounts.length ? 'No scored accounts yet' : 'No accounts yet'}
              description={
                accounts.length
                  ? 'Generate a report for one of your accounts to see it scored here.'
                  : 'Add a company and we will research it against what you sell.'
              }
              action={
                <Button
                  icon={Plus}
                  onClick={() => (accounts.length ? navigate('/accounts') : setModalOpen(true))}
                >
                  {accounts.length ? 'Go to accounts' : 'Add your first account'}
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {ranked.map((account) => (
                <button
                  key={account._id}
                  onClick={() =>
                    account.latestReport?._id
                      ? navigate(`/reports/${account.latestReport._id}`)
                      : navigate('/accounts')
                  }
                  className="card flex w-full items-center gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-raised"
                >
                  <ScoreRing value={account.latestReport.score} size={54} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-bold text-ink">{account.name}</span>
                      {account.latestReport.band && (
                        <Badge
                          tone={
                            account.latestReport.score >= 80
                              ? 'green'
                              : account.latestReport.score >= 60
                              ? 'brand'
                              : 'amber'
                          }
                        >
                          {account.latestReport.band}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                      {[account.industry, account.country].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <ArrowRight size={16} className="shrink-0 text-ink-faint" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          {/* The company profile lens every report is written through */}
          <Card className="card-pad">
            <h3 className="mb-3 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.12em] text-brand-600">
              <Sparkles size={13} /> Report focus
            </h3>

            <dl className="space-y-3 text-[13px]">
              <div>
                <dt className="font-semibold text-ink-faint">High-priority topics</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {priorityTopics.length ? (
                    priorityTopics.map((topic) => (
                      <span
                        key={topic}
                        className="rounded-md bg-emerald-50 px-2 py-0.5 text-2xs font-semibold text-emerald-700"
                      >
                        {topic}
                      </span>
                    ))
                  ) : (
                    <span className="text-ink-faint">None marked</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-faint">Other topics</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {otherTopics.length ? (
                    otherTopics.map((topic) => (
                      <span
                        key={topic}
                        className="rounded-md bg-brand-50 px-2 py-0.5 text-2xs font-semibold text-brand-700"
                      >
                        {topic}
                      </span>
                    ))
                  ) : (
                    <span className="text-ink-faint">None</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-faint">Capabilities</dt>
                <dd className="mt-0.5 text-ink-soft">
                  {organization?.capabilities?.join(', ') || 'Not set'}
                </dd>
              </div>
            </dl>

            <Link
              to="/settings"
              className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:text-brand-700"
            >
              {isAdmin ? 'Edit company profile' : 'View company profile'} <ArrowRight size={13} />
            </Link>
          </Card>

          {/* Recent reports */}
          <Card className="card-pad">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-faint">
                Recent reports
              </h3>
              <Link to="/reports" className="text-2xs font-semibold text-brand-600 hover:underline">
                All
              </Link>
            </div>

            {reports.length === 0 ? (
              <p className="text-[13px] text-ink-muted">Nothing generated yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {reports.slice(0, 5).map((report) => (
                  <li key={report._id}>
                    <button
                      onClick={() => navigate(`/reports/${report._id}`)}
                      className="flex w-full items-center gap-2.5 py-2.5 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-ink">
                          {report.companyName}
                        </span>
                        <span className="block text-2xs text-ink-faint">
                          {new Date(report.generatedAt).toLocaleDateString()}
                        </span>
                      </span>
                      {report.status === 'pending' ? (
                        <Loader2 size={14} className="animate-spin text-brand-500" />
                      ) : report.status === 'failed' ? (
                        <Badge tone="red">failed</Badge>
                      ) : (
                        <span
                          className={cx(
                            'text-[13px] font-bold',
                            (report.score?.value || 0) >= 70 ? 'text-emerald-600' : 'text-ink-muted'
                          )}
                        >
                          {report.score?.value ?? '—'}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Latest signals */}
          <Card className="card-pad">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-faint">
                Latest signals
              </h3>
              <Link to="/signals" className="text-2xs font-semibold text-brand-600 hover:underline">
                All
              </Link>
            </div>

            {signals.length === 0 ? (
              <p className="text-[13px] text-ink-muted">
                No signals in the last 7 days. Refresh an account to pull fresh news.
              </p>
            ) : (
              <ul className="space-y-3">
                {signals.slice(0, 4).map((signal) => (
                  <li key={signal._id} className="flex gap-2.5">
                    <span
                      className={cx(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        signal.priority === 'high'
                          ? 'bg-red-500'
                          : signal.priority === 'medium'
                          ? 'bg-amber-500'
                          : 'bg-slate-300'
                      )}
                    />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink-soft">
                        {signal.title}
                      </p>
                      <p className="mt-0.5 text-2xs text-ink-faint">
                        {signal.companyName} · {signal.type}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <AddAccountModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={({ reportId }) => {
          if (reportId) navigate(`/reports/${reportId}`);
          else load();
        }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  to,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: React.ElementType;
  tone: 'brand' | 'green' | 'purple' | 'amber';
  to: string;
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    purple: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
  };

  return (
    <Link to={to} className="card flex items-center gap-4 p-5 transition hover:shadow-raised">
      <span className={cx('flex h-11 w-11 items-center justify-center rounded-xl', tones[tone])}>
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <p className="text-2xs font-bold uppercase tracking-wider text-ink-faint">{label}</p>
        <p className="text-2xl font-extrabold leading-tight text-ink">{value}</p>
        {hint && <p className="text-2xs text-ink-muted">{hint}</p>}
      </div>
    </Link>
  );
}
