import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  FileText,
  Loader2,
  Plus,
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
  stagger,
} from '../components/ui';

/** Greeting that matches the clock — small touch, but it makes the app feel awake. */
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

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

  const { high: priorityTopics, all: allTopics } = focusTopics(organization);
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
        title={`${greeting()}, ${user?.firstName || 'there'}`}
        description={
          lens.length
            ? `We are reading every company below for where they need ${lens.join(' and ')}.`
            : 'Tell us the topics you care about and we will show you which companies need what you sell.'
        }
        actions={
          <Button icon={Plus} onClick={() => setModalOpen(true)}>
            Add a company
          </Button>
        }
      />

      {/* Company profile nudge. Only owners and admins can act on it. */}
      {incomplete && (
        <Card className="mb-6 animate-fade-in-up overflow-hidden border-brand-200 p-0">
          <div className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-90"
              style={{
                backgroundImage:
                  'linear-gradient(120deg, rgb(37 99 235 / 0.10) 0%, rgb(99 102 241 / 0.06) 45%, transparent 75%)',
              }}
            />
            <div className="relative flex flex-wrap items-start justify-between gap-4 p-6">
              <div className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-gradient shadow-brand">
                  <Target size={20} className="text-white" />
                </span>
                <div>
                  <h2 className="text-[17px] font-bold tracking-tight text-ink">
                    Tell us about your business
                  </h2>
                  <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-soft">
                    What your company sells and the topics you care about decide what every report
                    focuses on — the topics you mark as top priority lead the analysis.
                    {!isAdmin && ' Only an owner or admin can fill this in.'}
                  </p>
                </div>
              </div>
              {isAdmin && (
                <Button onClick={() => navigate('/settings')}>
                  Finish setup <ArrowRight size={15} />
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="stagger mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Companies tracked"
          value={accounts.length}
          icon={Building2}
          tone="brand"
          to="/accounts"
          index={0}
        />
        <Stat
          label="Strong matches"
          value={priorityCount}
          hint="Scoring 70 or higher"
          icon={TrendingUp}
          tone="green"
          to="/accounts"
          index={1}
        />
        <Stat
          label="Reports created"
          value={reports.length}
          hint={pendingCount ? `${pendingCount} being written now` : undefined}
          icon={FileText}
          tone="purple"
          to="/reports"
          index={2}
        />
        <Stat
          label="News this week"
          value={signals.length}
          icon={Bell}
          tone="amber"
          to="/signals"
          index={3}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* Ranked accounts */}
        <div>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-ink">Your best opportunities</h2>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Ranked by how well they fit what you sell.
              </p>
            </div>
            <Link
              to="/accounts"
              className="group inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 transition hover:text-brand-700"
            >
              See all
              <ArrowRight
                size={13}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Link>
          </div>

          {loading ? (
            <SkeletonRows rows={3} />
          ) : ranked.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={accounts.length ? 'No scores yet' : 'No companies yet'}
              description={
                accounts.length
                  ? 'Create a report for one of your companies to see how well it fits what you sell.'
                  : 'Add a company and we will research it against what you sell.'
              }
              action={
                <Button
                  icon={Plus}
                  onClick={() => (accounts.length ? navigate('/accounts') : setModalOpen(true))}
                >
                  {accounts.length ? 'Go to companies' : 'Add your first company'}
                </Button>
              }
            />
          ) : (
            <div className="stagger space-y-3">
              {ranked.map((account, i) => (
                <button
                  key={account._id}
                  style={stagger(i)}
                  onClick={() =>
                    account.latestReport?._id
                      ? navigate(`/reports/${account.latestReport._id}`)
                      : navigate('/accounts')
                  }
                  className="card card-interactive group flex w-full items-center gap-4 p-4 text-left"
                >
                  <ScoreRing value={account.latestReport.score} size={54} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-bold tracking-tight text-ink">
                        {account.name}
                      </span>
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
                  <ArrowRight
                    size={16}
                    className="shrink-0 text-ink-faint transition-all duration-200 ease-swift group-hover:translate-x-0.5 group-hover:text-brand-500"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          {/* Recent reports */}
          <Card className="card-pad">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="eyebrow text-ink-faint">Latest reports</h3>
              <Link
                to="/reports"
                className="text-2xs font-semibold text-brand-600 transition hover:underline"
              >
                See all
              </Link>
            </div>

            {reports.length === 0 ? (
              <p className="text-[13px] text-ink-muted">Nothing created yet.</p>
            ) : (
              <ul className="-mx-2 divide-y divide-slate-100">
                {reports.slice(0, 5).map((report) => (
                  <li key={report._id}>
                    <button
                      onClick={() => navigate(`/reports/${report._id}`)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left transition hover:bg-slate-50"
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
                        <Badge tone="red">not finished</Badge>
                      ) : (
                        <span
                          className={cx(
                            'text-[13px] font-bold tabular-nums',
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
              <h3 className="eyebrow text-ink-faint">Latest news</h3>
              <Link
                to="/signals"
                className="text-2xs font-semibold text-brand-600 transition hover:underline"
              >
                See all
              </Link>
            </div>

            {signals.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-ink-muted">
                No news in the last 7 days. Use “Check for news” on a company to look again.
              </p>
            ) : (
              <ul className="space-y-3.5">
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
  index,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: React.ElementType;
  tone: 'brand' | 'green' | 'purple' | 'amber';
  to: string;
  index: number;
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600 ring-brand-200',
    green: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
    purple: 'bg-violet-50 text-violet-600 ring-violet-200',
    amber: 'bg-amber-50 text-amber-600 ring-amber-200',
  };

  return (
    <Link
      to={to}
      style={stagger(index)}
      className="card card-interactive group relative flex items-center gap-4 overflow-hidden p-5"
    >
      <span
        className={cx(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset transition-transform duration-300 ease-swift group-hover:scale-110',
          tones[tone]
        )}
      >
        <Icon size={21} />
      </span>

      <div className="min-w-0">
        <p className="eyebrow text-ink-faint">{label}</p>
        <p className="mt-0.5 text-[28px] font-extrabold leading-none tracking-tighter text-ink tabular-nums">
          {value}
        </p>
        {hint && <p className="mt-1 text-2xs text-ink-muted">{hint}</p>}
      </div>

      <ArrowUpRight
        size={15}
        className="absolute right-4 top-4 text-ink-faint opacity-0 transition-all duration-200 ease-swift group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100"
      />
    </Link>
  );
}
