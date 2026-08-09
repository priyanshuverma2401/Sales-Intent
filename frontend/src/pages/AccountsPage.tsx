import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  ExternalLink,
  FileText,
  Loader2,
  Newspaper,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  AccountPages,
  AccountTags,
  accountsAPI,
  apiError,
  companiesAPI,
  reportsAPI,
} from '../services/api';
import { useAuthStore, focusTopics } from '../store/authStore';
import AddAccountModal from '../components/AddAccountModal';
import AccountSettingsModal from '../components/AccountSettingsModal';
import { usePoll } from '../lib/usePoll';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  OverflowMenu,
  PageHeader,
  ProgressBar,
  ScoreRing,
  SkeletonRows,
  stagger,
} from '../components/ui';

interface Account {
  _id: string;
  name: string;
  ticker?: string;
  industry?: string;
  country?: string;
  description?: string;
  website?: string;
  logoUrl?: string;
  employees?: number;
  signalCount: number;
  notes?: string;
  // Removing an account clears it for the whole team, so the server decides
  // who is allowed to and the row only renders what it is told.
  addedByName?: string | null;
  addedByMe?: boolean;
  canRemove?: boolean;
  // Crawl settings, editable via AccountSettingsModal. Shared across the
  // workspace: they are facts about the prospect, not one seat's opinion.
  pages?: AccountPages;
  tags?: AccountTags;
  financials?: { marketCap?: number; peRatio?: number };
  stock?: { currentPrice?: number };
  latestReport?: {
    _id: string;
    status: 'pending' | 'complete' | 'failed';
    progress?: { step?: string; percent?: number };
    error?: string;
    score?: number;
    band?: string;
    generatedAt?: string;
  } | null;
}

function money(value?: number) {
  if (!value) return null;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString()}`;
}

export default function AccountsPage() {
  const navigate = useNavigate();
  const { organization } = useAuthStore();

  // Every account in the tenant is read through the same lens - the company
  // profile - so it is shown once here rather than repeated on every row.
  const { high: priorityTopics, all: allTopics } = focusTopics(organization);
  const lens = priorityTopics.length ? priorityTopics : allTopics;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // The account whose crawl settings are being edited, or null when closed
  const [settingsFor, setSettingsFor] = useState<Account | null>(null);

  const [query, setQuery] = useState('');
  const [total, setTotal] = useState(0);

  // Typing must not fire a request per keystroke
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const res = await accountsAPI.getAccounts(search ? { q: search } : undefined);
        setAccounts(res.data);
        setTotal(Number(res.headers['x-total-count'] ?? res.data.length));
      } catch (err) {
        // Background polls fail quietly - see ReportsPage for the reasoning
        if (!silent) setMessage({ tone: 'error', text: apiError(err, 'Could not load accounts') });
      } finally {
        setLoading(false);
      }
    },
    [search]
  );

  // Refetches when the search changes, because `load` depends on it
  useEffect(() => {
    load();
  }, [load]);

  // Reports generate in the background, so keep checking while any are running
  const hasPending = accounts.some((a) => a.latestReport?.status === 'pending');
  usePoll(() => load(true), { active: hasPending });

  const refresh = async (account: Account) => {
    try {
      setBusyId(account._id);
      const res = await companiesAPI.refreshData(account._id);
      setMessage({
        tone: 'success',
        text: `${account.name}: found ${res.data.signalsCreated ?? 0} new updates across ${res.data.newsFound ?? 0} articles`,
      });
      load(true);
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err, `Could not refresh ${account.name}`) });
    } finally {
      setBusyId(null);
    }
  };

  const generate = async (account: Account) => {
    try {
      setBusyId(account._id);
      await reportsAPI.generate(account._id);
      setMessage({
        tone: 'info',
        text: `Writing a ${lens.join(' / ') || 'fit'} report for ${account.name}. This takes about a minute.`,
      });
      load(true);
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err, 'We could not start the report') });
    } finally {
      setBusyId(null);
    }
  };

  // Removal is team-wide now, and it takes the reports with it, so the prompt
  // has to say so rather than the old "remove from your companies?".
  const remove = async (account: Account) => {
    const confirmed = window.confirm(
      `Remove ${account.name} for the whole team?\n\n` +
        'It comes off everyone’s list and its reports are deleted. This cannot be undone.'
    );
    if (!confirmed) return;

    try {
      setBusyId(account._id);
      const res = await companiesAPI.removeCompany(account._id);
      const deleted = res.data?.reportsDeleted || 0;
      setMessage({
        tone: 'success',
        text: `${account.name} removed for the team${
          deleted ? ` — ${deleted} report${deleted === 1 ? '' : 's'} deleted` : ''
        }`,
      });
      load(true);
    } catch (err) {
      setMessage({ tone: 'error', text: apiError(err, 'Could not remove the account') });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Your pipeline"
        title="Accounts"
        description="Every company you are working on, scored on how well they fit what you sell."
        actions={
          <Button icon={Plus} onClick={() => setModalOpen(true)}>
            Add a company
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

      {/* The shared lens, stated once */}
      {lens.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200/70 bg-surface/60 px-3.5 py-2.5">
          <Sparkles size={13} className="text-brand-500" />
          <span className="eyebrow text-ink-faint">We check every company for</span>
          {lens.map((topic) => (
            <span
              key={topic}
              className="rounded-md bg-brand-50 px-2 py-0.5 text-2xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      {/* Search. Keyed off the unfiltered total so the box - and the Clear
          button - survive a query that matches nothing. */}
      {total > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              className="input pl-9"
              placeholder="Search by company name, ticker, industry or country…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {query.trim() && (
            <button
              onClick={() => setQuery('')}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold text-ink-muted transition hover:bg-slate-100 hover:text-ink"
            >
              <X size={14} /> Clear
            </button>
          )}

          <span className="ml-auto shrink-0 text-[13px] font-medium text-ink-muted">
            {search ? `${accounts.length} of ${total}` : `${total} companies`}
          </span>
        </div>
      )}

      {loading ? (
        <SkeletonRows rows={3} />
      ) : accounts.length === 0 && search ? (
        <EmptyState
          icon={Search}
          title="No companies match that search"
          description={`Nothing in your pipeline matches “${search}”.`}
          action={
            <Button variant="secondary" icon={X} onClick={() => setQuery('')}>
              Clear search
            </Button>
          }
        />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No companies yet"
          description="Add a company and we will research it against your business profile — what you sell and the topics you care about — then write the report for you."
          action={
            <Button icon={Plus} onClick={() => setModalOpen(true)}>
              Add your first company
            </Button>
          }
        />
      ) : (
        <div className="stagger space-y-4">
          {accounts.map((account, i) => {
            const report = account.latestReport;
            const busy = busyId === account._id;

            return (
              <div
                key={account._id}
                style={stagger(i)}
                className="card overflow-hidden hover:border-slate-300 hover:shadow-raised"
              >
                <div className="flex items-start gap-4 p-4 sm:gap-5 sm:p-5">
                  {/* Score */}
                  <div className="shrink-0">
                    {report?.status === 'complete' && report.score ? (
                      <ScoreRing value={report.score} band={report.band} size={64} />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-slate-200 bg-slate-50/50">
                        {report?.status === 'pending' ? (
                          <Loader2 size={18} className="animate-spin text-brand-500" />
                        ) : (
                          <span className="px-1 text-center text-2xs font-semibold leading-tight text-ink-faint">
                            Not scored
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[17px] font-bold tracking-tight text-ink">{account.name}</h2>
                      {account.ticker && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-2xs font-semibold text-ink-muted">
                          {account.ticker}
                        </span>
                      )}
                      {account.signalCount > 0 && (
                        <Badge tone="amber">
                          {account.signalCount} {account.signalCount === 1 ? 'update' : 'updates'}
                        </Badge>
                      )}
                      {report?.status === 'pending' && (
                        <Badge tone="brand">
                          <Loader2 size={10} className="animate-spin" />
                          {report.progress?.step || 'Writing report'}
                        </Badge>
                      )}
                      {report?.status === 'failed' && (
                        <Badge tone="red">Report did not finish</Badge>
                      )}
                    </div>

                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      {[
                        account.industry,
                        account.country,
                        // One shared account per company now, so whose board it
                        // came from is worth stating on the row itself.
                        account.addedByName && !account.addedByMe
                          ? `added by ${account.addedByName}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'We are still gathering details'}
                    </p>

                    {account.description && (
                      <p className="mt-2 line-clamp-2 text-[13.5px] leading-relaxed text-ink-soft">
                        {account.description}
                      </p>
                    )}

                    {/* Facts */}
                    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
                      {account.employees ? (
                        <span>
                          Employees <strong className="text-ink-soft">{account.employees.toLocaleString()}</strong>
                        </span>
                      ) : null}
                      {money(account.financials?.marketCap) && (
                        <span>
                          Market cap{' '}
                          <strong className="text-ink-soft">{money(account.financials?.marketCap)}</strong>
                        </span>
                      )}
                      {account.stock?.currentPrice ? (
                        <span>
                          Price <strong className="text-ink-soft">${account.stock.currentPrice}</strong>
                        </span>
                      ) : null}
                      {account.website && (
                        <a
                          href={account.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700"
                        >
                          Website <ExternalLink size={11} />
                        </a>
                      )}
                    </div>

                    {report?.status === 'failed' && report.error && (
                      <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">
                        {report.error}
                      </p>
                    )}
                  </div>

                  {/* Actions. One primary button, everything else behind the
                      menu - stacking five buttons made the row's height a
                      function of how many things you could do to it rather
                      than of how much there was to read. */}
                  <div className="flex shrink-0 items-center gap-2">
                    {report?.status === 'complete' ? (
                      <Button
                        size="sm"
                        icon={FileText}
                        onClick={() => navigate(`/reports/${report._id}`)}
                      >
                        <span className="hidden sm:inline">View report</span>
                        <span className="sm:hidden">View</span>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        icon={FileText}
                        loading={busy}
                        disabled={report?.status === 'pending'}
                        onClick={() => generate(account)}
                      >
                        {report?.status === 'pending' ? 'Writing…' : 'Create report'}
                      </Button>
                    )}

                    <OverflowMenu
                      label={`Actions for ${account.name}`}
                      actions={[
                        {
                          // "Write a new one" deliberately lives on the report
                          // itself and nowhere else: rewriting is a decision
                          // you make after reading what is already there.
                          label: 'Check for news',
                          icon: Newspaper,
                          disabled: busy,
                          onClick: () => refresh(account),
                        },
                        {
                          // The careers and IR URLs, and which narrow crawls
                          // run. Nothing else in the app can set these, and
                          // without a careers URL a Workday or iCIMS account
                          // produces no hiring numbers at all.
                          label: 'Settings',
                          icon: Settings2,
                          disabled: busy,
                          onClick: () => setSettingsFor(account),
                        },
                        {
                          label: 'Remove for the team',
                          icon: Trash2,
                          danger: true,
                          // Only the person who added it, or an admin. The
                          // server decides; this just renders the answer.
                          hidden: account.canRemove === false,
                          disabled: busy,
                          hint: account.addedByName
                            ? `Added by ${account.addedByName}`
                            : undefined,
                          onClick: () => remove(account),
                        },
                      ]}
                    />
                  </div>
                </div>

                {/* Progress strip while a report builds */}
                {report?.status === 'pending' && (
                  <ProgressBar percent={report.progress?.percent} className="h-1 rounded-none" />
                )}
              </div>
            );
          })}
        </div>
      )}

      <AccountSettingsModal
        open={Boolean(settingsFor)}
        account={settingsFor}
        onClose={() => setSettingsFor(null)}
        onSaved={() => {
          load(true);
          setMessage({
            tone: 'success',
            text: `${settingsFor?.name} settings saved. They take effect on the next report or refresh.`,
          });
        }}
      />

      <AddAccountModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={({ companyName, reportId, reportError, alreadyTracked, addedByName }) => {
          load(true);

          // Adding a company the team already has is not an error and not a
          // second copy - it refreshes the account and writes a fresh report.
          const added = alreadyTracked
            ? `${companyName} is already tracked${addedByName ? ` (added by ${addedByName})` : ''} — refreshing it`
            : `${companyName} added`;

          if (reportError) {
            setMessage({
              tone: 'error',
              text: `${added}, but the report did not start: ${reportError.error}`,
            });
          } else if (reportId) {
            setMessage({
              tone: 'info',
              text: `${added} — we are writing a new report now.`,
            });
          } else {
            setMessage({ tone: 'success', text: `${added}.` });
          }
        }}
      />

      {accounts.length > 0 && (
        <p className="mt-8 text-center text-[13px] text-ink-muted">
          Want us to look for something else? Update what you sell and the topics you care about in{' '}
          <Link to="/settings" className="font-semibold text-brand-600 hover:underline">
            Settings
          </Link>
          .
        </p>
      )}
    </div>
  );
}
