import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Radio,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { AnalyticsOverview, analyticsAPI, apiError } from '../services/api';
import { useAuthStore } from '../store/authStore';
import ActivityLogPanel from '../components/ActivityLogPanel';
import { ChartCard, ChartTooltip, LegendKey, NoData, axisProps, useChartPalette } from '../components/charts';
import { Alert, Badge, Card, PageHeader, cx, stagger } from '../components/ui';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

// Deliberately not a random palette: these three mean states, not identities,
// and each ships with its own word beside it in the UI.
const STATUS_META: Record<string, { label: string; key: 'good' | 'warning' | 'critical'; icon: React.ElementType }> = {
  complete: { label: 'Finished', key: 'good', icon: CheckCircle2 },
  pending: { label: 'Still writing', key: 'warning', icon: Clock },
  failed: { label: 'Did not finish', key: 'critical', icon: XCircle },
};

const SIGNAL_LABELS: Record<string, string> = {
  earnings: 'Earnings',
  news: 'News',
  hiring: 'Hiring',
  executive: 'People moves',
  funding: 'Funding',
  ma: 'M&A',
  product: 'Product',
  regulation: 'Regulation',
  partnership: 'Partnerships',
  documents: 'Documents',
  podcasts: 'Podcasts',
  crm: 'CRM',
  program: 'Programmes',
  patent: 'Patents',
  contract: 'Contracts',
};

const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Signing in',
  account: 'Own profile',
  accounts: 'Accounts',
  reports: 'Reports',
  team: 'Team',
  settings: 'Settings',
  integrations: 'Connected apps',
  security: 'Security',
  alerts: 'Alert rules',
  inbox: 'Inbox',
  signals: 'Signals',
  system: 'System',
  other: 'Other',
};

const shortDate = (iso: string) => format(parseISO(iso), 'd MMM');
const longDate = (iso: string) => format(parseISO(iso), 'EEEE d MMMM');

export default function AnalyticsPage() {
  const { organization } = useAuthStore();
  const palette = useChartPalette();

  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    setRefreshing(true);
    analyticsAPI
      .overview(days)
      .then((res) => {
        if (requestRef.current !== requestId) return;
        setData(res.data);
        setError(null);
      })
      .catch((err) => {
        if (requestRef.current !== requestId) return;
        setError(apiError(err, 'The analytics could not be loaded'));
      })
      .finally(() => {
        if (requestRef.current !== requestId) return;
        setLoading(false);
        setRefreshing(false);
      });
  }, [days]);

  const kpis = data?.kpis;

  // Bars are drawn biggest-first so the chart reads top-down like a ranking
  const activityBars = useMemo(
    () =>
      (data?.breakdown.activityCategories || []).map((row) => ({
        name: CATEGORY_LABELS[row.category] || row.category,
        count: row.count,
      })),
    [data]
  );

  const signalBars = useMemo(
    () =>
      (data?.breakdown.signalTypes || []).map((row) => ({
        name: SIGNAL_LABELS[row.type] || row.type,
        count: row.count,
      })),
    [data]
  );

  const statusBars = useMemo(
    () =>
      (data?.breakdown.reportStatus || []).map((row) => ({
        name: STATUS_META[row.status]?.label || row.status,
        key: STATUS_META[row.status]?.key || 'good',
        count: row.count,
      })),
    [data]
  );

  const hasActivity = (data?.kpis.actionsInRange || 0) > 0;
  const busiestPeople = useMemo(() => (data?.people || []).slice(0, 8), [data]);
  const busiestMax = Math.max(1, ...busiestPeople.map((p) => p.actions));

  return (
    <div>
      <PageHeader
        eyebrow={organization?.name}
        title="Analytics & activity"
        description="What your team produced, and a record of every action they took. Only owners and admins can see this page."
        actions={
          <div
            role="radiogroup"
            aria-label="Time range"
            className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-surface p-1 shadow-card"
          >
            {RANGES.map((range) => (
              <button
                key={range.days}
                role="radio"
                aria-checked={days === range.days}
                onClick={() => setDays(range.days)}
                className={cx(
                  'rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-all duration-200 ease-swift',
                  days === range.days
                    ? 'bg-brand-gradient text-white shadow-brand'
                    : 'text-ink-muted hover:bg-slate-50 hover:text-ink'
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <div className="mb-5">
          <Alert tone="error" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shimmer h-[104px] rounded-2xl bg-slate-100" />
            ))}
          </div>
          <div className="shimmer h-[320px] rounded-2xl bg-slate-100" />
        </div>
      ) : !data ? null : (
        <div className={cx('space-y-6 transition-opacity', refreshing && 'opacity-60')}>
          {/* --- The headline numbers ---------------------------------------
              A stat tile, not a chart: each of these is one number, and a
              one-bar bar chart would say less than the number itself. */}
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Stat
              index={0}
              icon={FileText}
              tone="brand"
              label="Reports created"
              value={kpis!.reportsInRange}
              hint={`${kpis!.reportsAllTime.toLocaleString()} since you started${
                kpis!.reportsPending ? ` · ${kpis!.reportsPending} in progress` : ''
              }`}
            />
            <Stat
              index={1}
              icon={Building2}
              tone="violet"
              label="Accounts being tracked"
              value={kpis!.accountsTracked}
              hint={`${kpis!.accountsWithReports} of them have a report`}
            />
            <Stat
              index={2}
              icon={Users}
              tone="green"
              label="People who did something"
              value={kpis!.activeMembers}
              hint={`of ${kpis!.members} on the team${kpis!.seats ? ` · ${kpis!.seats} seats` : ''}`}
            />
            <Stat
              index={3}
              icon={Radio}
              tone="amber"
              label="Buying signals found"
              value={kpis!.signalsInRange}
              hint="Across every account you watch"
            />
            <Stat
              index={4}
              icon={Activity}
              tone="brand"
              label="Actions recorded"
              value={kpis!.actionsInRange}
              hint={`Kept for ${data.retentionDays} days`}
            />
            <Stat
              index={5}
              icon={ShieldAlert}
              tone={kpis!.failedActions > 0 ? 'red' : 'green'}
              label="Refused attempts"
              value={kpis!.failedActions}
              hint={
                kpis!.failedActions > 0
                  ? 'Rejected sign-ins or actions someone was not allowed to take'
                  : 'Nothing was rejected in this period'
              }
            />
          </div>

          {/* --- How busy the team was -------------------------------------- */}
          <ChartCard
            title="Team activity, day by day"
            description="Every recorded action, including sign-ins. Flat days are quiet days, not missing data."
            legend={<LegendKey color={palette.series[0]} label="Actions" value={kpis!.actionsInRange} />}
          >
            {hasActivity ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.series} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={palette.series[0]} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={palette.series[0]} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={palette.grid} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps(palette)} />
                  <YAxis allowDecimals={false} width={44} {...axisProps(palette)} />
                  <Tooltip
                    cursor={{ stroke: palette.axis, strokeWidth: 1 }}
                    content={<ChartTooltip labelFormatter={longDate} />}
                  />
                  <Area
                    type="monotone"
                    dataKey="actions"
                    name="Actions"
                    stroke={palette.series[0]}
                    strokeWidth={2}
                    fill="url(#activityFill)"
                    activeDot={{ r: 4, strokeWidth: 2, stroke: palette.surface }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <NoData message="No activity recorded in this period yet." height={220} />
            )}
          </ChartCard>

          {/* --- Output over time, and where the work landed ---------------- */}
          <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <ChartCard
              title="What the desk produced"
              description="Reports written, and new accounts added to the workspace."
              legend={
                <>
                  <LegendKey color={palette.series[0]} label="Reports" value={kpis!.reportsInRange} />
                  <LegendKey color={palette.series[1]} label="Accounts added" />
                </>
              }
            >
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={data.series} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={palette.grid} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps(palette)} />
                  <YAxis allowDecimals={false} width={44} {...axisProps(palette)} />
                  <Tooltip
                    cursor={{ stroke: palette.axis, strokeWidth: 1 }}
                    content={<ChartTooltip labelFormatter={longDate} />}
                  />
                  <Line
                    type="monotone"
                    dataKey="reports"
                    name="Reports"
                    stroke={palette.series[0]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: palette.surface }}
                  />
                  <Line
                    type="monotone"
                    dataKey="accounts"
                    name="Accounts added"
                    stroke={palette.series[1]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: palette.surface }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="How reports finished"
              description="A report that did not finish is usually a missing source, not a bad account."
            >
              {statusBars.some((s) => s.count > 0) ? (
                <ul className="space-y-3.5 pt-1">
                  {statusBars.map((row) => {
                    const total = statusBars.reduce((sum, r) => sum + r.count, 0) || 1;
                    const meta = Object.values(STATUS_META).find((m) => m.label === row.name);
                    const Icon = meta?.icon || CheckCircle2;
                    const color = palette.status[row.key];

                    return (
                      <li key={row.name}>
                        <div className="mb-1.5 flex items-center gap-2 text-[13px]">
                          <Icon size={14} style={{ color }} aria-hidden />
                          <span className="font-medium text-ink-soft">{row.name}</span>
                          <span className="ml-auto font-bold tabular-nums text-ink">{row.count}</span>
                          <span className="w-11 text-right text-2xs tabular-nums text-ink-faint">
                            {Math.round((row.count / total) * 100)}%
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full transition-[width] duration-700 ease-swift"
                            style={{ width: `${(row.count / total) * 100}%`, backgroundColor: color }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <NoData message="No reports in this period." height={160} />
              )}
            </ChartCard>
          </div>

          {/* --- Fit scores and where the effort goes ----------------------- */}
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="How well accounts fit what you sell"
              description="Every report in this period, grouped by its fit score. Higher is a better match."
            >
              {data.breakdown.scoreBands.some((b) => b.count > 0) ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.breakdown.scoreBands} margin={{ top: 16, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke={palette.grid} vertical={false} />
                    <XAxis dataKey="band" {...axisProps(palette)} />
                    <YAxis allowDecimals={false} width={44} {...axisProps(palette)} />
                    <Tooltip cursor={{ fill: palette.grid, fillOpacity: 0.35 }} content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Reports" radius={[4, 4, 0, 0]} maxBarSize={54}>
                      {/* An ordered ramp, because the bands themselves are
                          ordered - a stronger fit reads as a deeper blue. */}
                      {data.breakdown.scoreBands.map((band, i) => (
                        <Cell key={band.band} fill={palette.ordinal[i] || palette.ordinal[3]} />
                      ))}
                      <LabelList
                        dataKey="count"
                        position="top"
                        offset={8}
                        className="fill-ink"
                        style={{ fontSize: 12, fontWeight: 700 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <NoData message="No scored reports in this period." height={220} />
              )}
            </ChartCard>

            <ChartCard
              title="Where the team spends its time"
              description="Recorded actions grouped by the part of the product they touched."
            >
              {activityBars.length ? (
                <ResponsiveContainer width="100%" height={Math.max(180, activityBars.length * 34 + 24)}>
                  <BarChart
                    layout="vertical"
                    data={activityBars}
                    margin={{ top: 0, right: 44, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid stroke={palette.grid} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={118}
                      {...axisProps(palette)}
                      tick={{ fill: palette.axis, fontSize: 12 }}
                    />
                    <Tooltip cursor={{ fill: palette.grid, fillOpacity: 0.35 }} content={<ChartTooltip />} />
                    <Bar
                      dataKey="count"
                      name="Actions"
                      fill={palette.series[0]}
                      radius={[0, 4, 4, 0]}
                      barSize={14}
                    >
                      <LabelList
                        dataKey="count"
                        position="right"
                        offset={8}
                        className="fill-ink"
                        style={{ fontSize: 12, fontWeight: 700 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <NoData message="No activity recorded in this period." />
              )}
            </ChartCard>
          </div>

          {/* --- Signals ----------------------------------------------------- */}
          {signalBars.length > 0 && (
            <ChartCard
              title="What kind of news came in"
              description="Buying signals picked up across every account your team watches."
            >
              <ResponsiveContainer width="100%" height={Math.max(180, signalBars.length * 32 + 24)}>
                <BarChart layout="vertical" data={signalBars} margin={{ top: 0, right: 44, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={palette.grid} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={118}
                    {...axisProps(palette)}
                    tick={{ fill: palette.axis, fontSize: 12 }}
                  />
                  <Tooltip cursor={{ fill: palette.grid, fillOpacity: 0.35 }} content={<ChartTooltip />} />
                  <Bar dataKey="count" name="Signals" fill={palette.series[2]} radius={[0, 4, 4, 0]} barSize={14}>
                    <LabelList
                      dataKey="count"
                      position="right"
                      offset={8}
                      className="fill-ink"
                      style={{ fontSize: 12, fontWeight: 700 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* --- People and accounts ----------------------------------------- */}
          <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
            <Card className="card-pad">
              <header className="mb-4">
                <h3 className="text-[15px] font-bold tracking-tight text-ink">Who did what</h3>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">
                  Everyone on the team, busiest first. A seat with nothing beside it is a seat nobody is using.
                </p>
              </header>

              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200/80">
                      {['Person', 'Actions', 'Reports', 'Accounts', 'Avg fit', 'Last seen'].map((heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className="px-2 pb-2 text-2xs font-bold uppercase tracking-[0.1em] text-ink-faint"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {busiestPeople.map((row) => (
                      <tr key={row._id} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-2.5">
                          <p className="truncate text-[13px] font-semibold text-ink">{row.name}</p>
                          <p className="truncate text-2xs capitalize text-ink-faint">{row.role}</p>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2">
                            {/* The bar restates the number it sits beside, so
                                the column scans as a ranking at a glance. */}
                            <span
                              className="h-1.5 rounded-full"
                              style={{
                                width: `${Math.max(4, (row.actions / busiestMax) * 64)}px`,
                                backgroundColor: palette.series[0],
                              }}
                              aria-hidden
                            />
                            <span className="text-[13px] font-bold tabular-nums text-ink">{row.actions}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-[13px] tabular-nums text-ink-soft">{row.reports}</td>
                        <td className="px-2 py-2.5 text-[13px] tabular-nums text-ink-soft">{row.accounts}</td>
                        <td className="px-2 py-2.5 text-[13px] tabular-nums text-ink-soft">
                          {row.avgScore ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-2xs text-ink-muted">
                          {row.lastActive
                            ? formatDistanceToNow(parseISO(row.lastActive), { addSuffix: true })
                            : 'Never'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.people.length > busiestPeople.length && (
                <p className="mt-3 text-2xs text-ink-faint">
                  Showing the {busiestPeople.length} busiest of {data.people.length} people.{' '}
                  <Link to="/settings" className="font-semibold text-brand-600 hover:underline">
                    Manage the team
                  </Link>
                </p>
              )}
            </Card>

            <Card className="card-pad">
              <header className="mb-4">
                <h3 className="text-[15px] font-bold tracking-tight text-ink">Most researched accounts</h3>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">
                  Where the reporting effort went in this period.
                </p>
              </header>

              {data.topAccounts.length === 0 ? (
                <NoData message="No reports in this period." height={140} />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.topAccounts.map((account) => (
                    <li key={account._id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold text-ink">{account.name}</p>
                        <p className="text-2xs text-ink-faint">
                          {account.reports} report{account.reports === 1 ? '' : 's'} ·{' '}
                          {formatDistanceToNow(parseISO(account.lastAt), { addSuffix: true })}
                        </p>
                      </div>
                      {account.bestScore != null && (
                        <Badge
                          tone={
                            account.bestScore >= 80 ? 'green' : account.bestScore >= 60 ? 'brand' : 'neutral'
                          }
                        >
                          {account.bestScore} fit
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* --- Anything that was refused ----------------------------------- */}
          {kpis!.failedActions > 0 && (
            <Card className="card-pad border-red-200">
              <div className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 ring-1 ring-inset ring-red-200">
                  <AlertTriangle size={17} />
                </span>
                <div>
                  <h3 className="text-[15px] font-bold tracking-tight text-ink">
                    {kpis!.failedActions} attempt{kpis!.failedActions === 1 ? '' : 's'} {kpis!.failedActions === 1 ? 'was' : 'were'} refused
                  </h3>
                  <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
                    Rejected sign-ins, or actions someone was not permitted to take. A handful is normal —
                    people mistype passwords. A cluster from one address in a short window is not.
                    Filter the log below by <strong className="font-semibold">Was refused</strong> to see them.
                  </p>
                </div>
              </div>
            </Card>
          )}

          <ActivityLogPanel />
        </div>
      )}
    </div>
  );
}

/**
 * One headline number. A stat tile rather than a chart on purpose: a single
 * value is best read as the value, not as a bar with nothing to compare against.
 */
function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  index,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: React.ElementType;
  tone: 'brand' | 'green' | 'violet' | 'amber' | 'red';
  index: number;
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600 ring-brand-200',
    green: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
    violet: 'bg-violet-50 text-violet-600 ring-slate-200',
    amber: 'bg-amber-50 text-amber-600 ring-amber-200',
    red: 'bg-red-50 text-red-600 ring-red-200',
  };

  return (
    <div className="card flex items-start gap-4 p-5" style={stagger(index)}>
      <span
        className={cx(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
          tones[tone]
        )}
      >
        <Icon size={19} />
      </span>
      <div className="min-w-0">
        <p className="eyebrow text-ink-faint">{label}</p>
        {/* Proportional figures: tabular digits make a large standalone number
            read loose. Alignment only matters in the tables below. */}
        <p className="mt-0.5 text-[28px] font-extrabold leading-none tracking-tighter text-ink">
          {value.toLocaleString()}
        </p>
        {hint && <p className="mt-1.5 text-2xs leading-relaxed text-ink-muted">{hint}</p>}
      </div>
    </div>
  );
}
