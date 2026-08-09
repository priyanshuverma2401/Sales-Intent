import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import {
  AlertTriangle,
  Bell,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  Plug,
  Radio,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import {
  ActivityEntry,
  ActivityFilters,
  analyticsAPI,
  apiError,
  downloadActivityCsv,
} from '../services/api';
import { Alert, Badge, Button, EmptyState, cx } from './ui';

// How each category reads in the table. The icon is a second channel beside the
// wording - the row never relies on colour alone to say what kind of act it was.
const CATEGORY_STYLE: Record<string, { label: string; icon: React.ElementType; chip: string }> = {
  auth: { label: 'Sign-in', icon: LogIn, chip: 'bg-brand-50 text-brand-700 ring-brand-200' },
  account: { label: 'Profile', icon: UserCog, chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  accounts: { label: 'Accounts', icon: Building2, chip: 'bg-brand-50 text-brand-700 ring-brand-200' },
  reports: { label: 'Reports', icon: FileText, chip: 'bg-violet-50 text-violet-700 ring-slate-200' },
  team: { label: 'Team', icon: Users, chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  settings: { label: 'Settings', icon: Settings, chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  integrations: { label: 'Connected apps', icon: Plug, chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  security: { label: 'Security', icon: KeyRound, chip: 'bg-red-50 text-red-700 ring-red-200' },
  alerts: { label: 'Alert rules', icon: Bell, chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  inbox: { label: 'Inbox', icon: Mail, chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  signals: { label: 'Signals', icon: Radio, chip: 'bg-brand-50 text-brand-700 ring-brand-200' },
  system: { label: 'System', icon: ShieldCheck, chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  other: { label: 'Other', icon: Radio, chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

function categoryStyle(category: string) {
  return CATEGORY_STYLE[category] || CATEGORY_STYLE.other;
}

/** 'report.generate' -> 'Report generate'. Only for the raw-action dropdown. */
function prettyAction(action: string) {
  const words = action.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function initialsOf(name?: string) {
  return (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

const EMPTY_FILTERS: ActivityFilters = {
  userId: '',
  category: 'all',
  action: 'all',
  outcome: '',
  q: '',
  from: '',
  to: '',
};

// Only the keys the API understands, and only the ones actually set. Sending
// `category=all` would be harmless but it clutters the URL the admin can copy.
function toParams(filters: ActivityFilters, page: number, limit: number): ActivityFilters {
  const params: ActivityFilters = { page, limit };
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== 'all') (params as any)[key] = value;
  });
  return params;
}

export default function ActivityLogPanel() {
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_FILTERS);
  // The search box updates on every keystroke; the query it drives does not.
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [options, setOptions] = useState<{
    actions: string[];
    categories: string[];
    members: { _id: string; name: string; email: string; role: string }[];
    retentionDays: number;
  }>({ actions: [], categories: [], members: [], retentionDays: 365 });

  // Kept in a ref so an in-flight response that has been superseded cannot
  // overwrite a newer one - typing quickly used to make results flicker back.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    setRefreshing(true);
    setError(null);

    try {
      const res = await analyticsAPI.activity(toParams(filters, page, limit));
      if (requestRef.current !== requestId) return;

      setEntries(res.data.entries);
      setTotal(res.data.total);
      setPages(res.data.pages);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      setError(apiError(err, 'The activity log could not be loaded'));
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filters, page, limit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    analyticsAPI
      .filters()
      .then((res) => setOptions(res.data))
      .catch(() => {});
  }, []);

  // Debounced: a filter that fires per keystroke turns a search into a dozen
  // queries over the whole retained history.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }));
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const setFilter = (patch: Partial<ActivityFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const reset = () => {
    setSearch('');
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const isFiltered = useMemo(
    () => Object.entries(filters).some(([key, value]) => value && value !== (EMPTY_FILTERS as any)[key]),
    [filters]
  );

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadActivityCsv(toParams(filters, 1, limit));
    } catch (err) {
      setError(apiError(err, 'The export could not be produced'));
    } finally {
      setExporting(false);
    }
  };

  const firstRow = total === 0 ? 0 : (page - 1) * limit + 1;
  const lastRow = Math.min(page * limit, total);

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-slate-200/80 p-5 sm:p-6">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-ink">Activity log</h2>
          <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Every action anyone here takes — owners and admins included. Sign-ins and rejected
            attempts, reports opened and downloaded, accounts and teammates added or removed.
            Entries are kept for {options.retentionDays} days.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={Download} loading={exporting} onClick={onExport}>
          Export CSV
        </Button>
      </header>

      {/* One filter row above the table, scoping everything below it */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-surface-2 px-5 py-3 sm:px-6">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people, actions, accounts or IP addresses"
            aria-label="Search the activity log"
            className="input !py-2 pl-9 text-[13px]"
          />
        </div>

        <select
          value={filters.userId || ''}
          onChange={(e) => setFilter({ userId: e.target.value })}
          aria-label="Filter by person"
          className="input !w-auto !py-2 text-[13px]"
        >
          <option value="">Everyone</option>
          {options.members.map((m) => (
            <option key={m._id} value={m._id}>
              {m.name}
            </option>
          ))}
        </select>

        <select
          value={filters.category || 'all'}
          onChange={(e) => setFilter({ category: e.target.value })}
          aria-label="Filter by area"
          className="input !w-auto !py-2 text-[13px]"
        >
          <option value="all">All areas</option>
          {options.categories.map((c) => (
            <option key={c} value={c}>
              {categoryStyle(c).label}
            </option>
          ))}
        </select>

        <select
          value={filters.action || 'all'}
          onChange={(e) => setFilter({ action: e.target.value })}
          aria-label="Filter by action"
          className="input !w-auto !py-2 text-[13px]"
        >
          <option value="all">Any action</option>
          {options.actions.map((a) => (
            <option key={a} value={a}>
              {prettyAction(a)}
            </option>
          ))}
        </select>

        <select
          value={filters.outcome || ''}
          onChange={(e) => setFilter({ outcome: e.target.value })}
          aria-label="Filter by outcome"
          className="input !w-auto !py-2 text-[13px]"
        >
          <option value="">Worked or not</option>
          <option value="success">Worked</option>
          <option value="failure">Was refused</option>
        </select>

        <input
          type="date"
          value={filters.from || ''}
          onChange={(e) => setFilter({ from: e.target.value })}
          aria-label="From date"
          className="input !w-auto !py-2 text-[13px]"
        />
        <input
          type="date"
          value={filters.to || ''}
          onChange={(e) => setFilter({ to: e.target.value })}
          aria-label="To date"
          className="input !w-auto !py-2 text-[13px]"
        />

        {isFiltered && (
          <Button variant="ghost" size="sm" icon={RotateCcw} onClick={reset}>
            Clear
          </Button>
        )}
        {refreshing && !loading && <Loader2 size={15} className="animate-spin text-brand-500" />}
      </div>

      {error && (
        <div className="p-5 sm:p-6">
          <Alert tone="error" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}

      {loading ? (
        <div className="space-y-3 p-5 sm:p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shimmer h-12 rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="p-5 sm:p-6">
          <EmptyState
            icon={Search}
            title={isFiltered ? 'Nothing matches those filters' : 'Nothing recorded yet'}
            description={
              isFiltered
                ? 'Widen the date range or clear a filter to see more.'
                : 'Actions appear here as your team works. Sign-ins, reports and account changes are all recorded.'
            }
            action={isFiltered ? <Button variant="secondary" onClick={reset}>Clear filters</Button> : undefined}
          />
        </div>
      ) : (
        <>
          {/* Held at reduced opacity while refetching rather than replaced by a
              skeleton, so changing a filter does not make the page jump. */}
          <div className={cx('overflow-x-auto transition-opacity', refreshing && 'opacity-60')}>
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200/80 bg-surface-2">
                  {['When', 'Who', 'Area', 'What happened', 'From', ''].map((heading, i) => (
                    <th
                      key={heading || i}
                      scope="col"
                      className="px-4 py-2.5 text-2xs font-bold uppercase tracking-[0.1em] text-ink-faint"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <LogRow
                    key={entry._id}
                    entry={entry}
                    expanded={expanded === entry._id}
                    onToggle={() => setExpanded(expanded === entry._id ? null : entry._id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 px-5 py-3 sm:px-6">
            <p className="text-[13px] text-ink-muted">
              Showing <span className="font-semibold tabular-nums text-ink">{firstRow}</span>–
              <span className="font-semibold tabular-nums text-ink">{lastRow}</span> of{' '}
              <span className="font-semibold tabular-nums text-ink">{total.toLocaleString()}</span>
            </p>

            <div className="flex items-center gap-2">
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                aria-label="Rows per page"
                className="input !w-auto !py-1.5 text-[13px]"
              >
                {[25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>
                    {n} per page
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                icon={ChevronLeft}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Back
              </Button>
              <span className="text-[13px] tabular-nums text-ink-muted">
                {page} / {pages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
              >
                Next <ChevronRight size={14} />
              </Button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}

/**
 * One row, expandable. The summary answers who/what/when at a glance; the
 * expansion carries the forensic detail - the exact endpoint, the response
 * code, the browser and whatever the action recorded about itself.
 */
function LogRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: ActivityEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const style = categoryStyle(entry.category);
  const Icon = style.icon;
  const when = parseISO(entry.createdAt);
  const failed = entry.outcome === 'failure';

  return (
    <>
      <tr
        onClick={onToggle}
        className={cx(
          'cursor-pointer border-b border-slate-100 align-top transition-colors hover:bg-surface-2',
          expanded && 'bg-surface-2'
        )}
      >
        <td className="whitespace-nowrap px-4 py-3">
          <p className="text-[13px] font-semibold tabular-nums text-ink">{format(when, 'd MMM, HH:mm')}</p>
          <p className="text-2xs text-ink-faint">{formatDistanceToNow(when, { addSuffix: true })}</p>
        </td>

        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-2xs font-bold text-white">
              {initialsOf(entry.actor?.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">{entry.actor?.name || 'Unknown'}</p>
              <p className="truncate text-2xs capitalize text-ink-faint">
                {entry.actor?.role || 'unknown'}
              </p>
            </div>
          </div>
        </td>

        <td className="px-4 py-3">
          <span
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset',
              style.chip
            )}
          >
            <Icon size={11} />
            {style.label}
          </span>
        </td>

        <td className="px-4 py-3">
          <p className="flex items-start gap-1.5 text-[13px] leading-snug text-ink-soft">
            {failed && <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-600" />}
            <span>{entry.description}</span>
          </p>
          {failed && (
            <span className="mt-1 inline-block">
              <Badge tone="red">Refused · {entry.statusCode}</Badge>
            </span>
          )}
        </td>

        <td className="whitespace-nowrap px-4 py-3 font-mono text-2xs text-ink-muted">
          {entry.ip || '—'}
        </td>

        <td className="px-2 py-3 text-right">
          <ChevronDown
            size={15}
            className={cx('text-ink-faint transition-transform duration-200', expanded && 'rotate-180')}
            aria-hidden
          />
          <span className="sr-only">{expanded ? 'Hide details' : 'Show details'}</span>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-100 bg-surface-2">
          <td colSpan={6} className="px-4 pb-4 pt-1">
            <dl className="grid gap-x-6 gap-y-2.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Action" value={entry.action} mono />
              <Detail label="Signed in as" value={entry.actor?.email} />
              <Detail
                label="Target"
                value={entry.target?.label || entry.target?.id || '—'}
              />
              <Detail
                label="Result"
                value={`${entry.method || ''} ${entry.statusCode ?? ''}${
                  entry.durationMs != null ? ` · ${entry.durationMs}ms` : ''
                }`.trim()}
                mono
              />
              <Detail label="Endpoint" value={entry.path} mono className="sm:col-span-2" />
              <Detail label="Browser" value={entry.userAgent} className="sm:col-span-2" />
              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <div className="sm:col-span-2 lg:col-span-4">
                  <dt className="mb-1 text-2xs font-bold uppercase tracking-[0.1em] text-ink-faint">
                    Recorded detail
                  </dt>
                  <dd>
                    <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-surface p-2.5 font-mono text-2xs leading-relaxed text-ink-soft">
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  </dd>
                </div>
              )}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-2xs font-bold uppercase tracking-[0.1em] text-ink-faint">{label}</dt>
      <dd className={cx('mt-0.5 break-words text-ink-soft', mono && 'font-mono text-2xs')}>
        {value || '—'}
      </dd>
    </div>
  );
}
