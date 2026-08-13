import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Loader2, Search } from 'lucide-react';
import { apiError, companiesAPI } from '../services/api';
import { Alert, Button, Field, Modal } from '../components/ui';

interface SearchResult {
  _id?: string;
  name: string;
  ticker?: string;
  industry?: string;
  source?: string;
  website?: string;
  logoUrl?: string;
  // What to try when the first mark 404s - see CompanyMark
  logoFallbackUrl?: string;
  wikidataId?: string;
}

/**
 * The company's mark, falling back through what we have and then to its
 * initial.
 *
 * A logo is the fastest way to tell the Microsoft you meant from the showcase
 * pages that share its name, but no single source has one for every company:
 * the brand CDN misses the obscure domains, Wikimedia Commons misses the
 * private ones. Each source is tried in turn rather than showing a broken
 * image icon, which is what a plain <img> would do here several times a page.
 */
function CompanyMark({
  name,
  logoUrl,
  fallbackUrl,
  size = 'sm',
}: {
  name: string;
  logoUrl?: string;
  fallbackUrl?: string;
  size?: 'sm' | 'md';
}) {
  const sources = useMemo(
    () => [logoUrl, fallbackUrl].filter(Boolean) as string[],
    [logoUrl, fallbackUrl]
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setAttempt(0), [sources]);

  const box = size === 'md' ? 'h-10 w-10' : 'h-9 w-9';
  const current = sources[attempt];

  if (current) {
    return (
      <img
        src={current}
        alt=""
        loading="lazy"
        onError={() => setAttempt((i) => i + 1)}
        className={`${box} shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1`}
      />
    );
  }

  return (
    <div
      className={`${box} flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm font-semibold uppercase text-ink-faint`}
    >
      {name?.trim()?.[0] || <Building2 size={15} />}
    </div>
  );
}

/**
 * Adding an account asks for one thing: the company. What the report focuses on
 * comes from the tenant's company profile, and the ticker is taken from the
 * search hit when there is one — neither is worth a field here.
 */
export default function AddAccountModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  // `alreadyTracked` is how the caller tells "we added this" apart from "the
  // team already had this, so we refreshed it". `reportRefreshing` says the
  // team's existing report is being rewritten rather than a new one written -
  // no second copy is ever filed for an account somebody has already researched.
  onAdded: (result: {
    companyName: string;
    reportId?: string | null;
    reportError?: any;
    alreadyTracked?: boolean;
    addedByName?: string | null;
    reportRefreshing?: boolean;
  }) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset to a clean slate each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setSelected(null);
    setError('');
  }, [open]);

  // Debounced search so a fast typist does not fire a request per keystroke
  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(() => {
      companiesAPI
        .search(query.trim())
        .then((res) => {
          if (!cancelled) setResults(res.data || []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected]);

  const choose = (result: SearchResult) => {
    setSelected(result);
    setResults([]);
  };

  const submit = async () => {
    const name = selected?.name || query.trim();
    if (!name) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await companiesAPI.addCompany({
        name,
        ticker: selected?.ticker || undefined,
        // Which company was picked, not just what it is called - the server
        // enriches from this entity and homepage rather than searching the
        // name again and hoping it lands on the same company
        wikidataId: selected?.wikidataId || undefined,
        website: selected?.website || undefined,
        generateReport: true,
      });

      onAdded({
        companyName: res.data?.company?.name || name,
        reportId: res.data?.reportId,
        reportError: res.data?.reportError,
        alreadyTracked: res.data?.alreadyTracked,
        addedByName: res.data?.addedByName,
        reportRefreshing: res.data?.reportRefreshing,
      });
      onClose();
    } catch (err) {
      setError(apiError(err, 'We could not add this company'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add a company"
      description="Search for the company you want to track. We will research it and write your first report straight away."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting} disabled={!selected && query.trim().length < 2}>
            Add &amp; write report
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        {/* ---- Company ---- */}
        {selected ? (
          <div className="flex animate-scale-in items-start justify-between gap-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3.5">
            <div className="flex min-w-0 gap-3">
              <CompanyMark
                name={selected.name}
                logoUrl={selected.logoUrl}
                fallbackUrl={selected.logoFallbackUrl}
                size="md"
              />
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{selected.name}</p>
                {/* The homepage, and nothing else: it is the one line that
                    confirms the right HDFC was picked before a report is
                    generated against it */}
                <p className="truncate text-xs font-semibold text-brand-700">
                  {selected.website || 'No website on record'}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setSelected(null);
                setQuery('');
              }}
              className="shrink-0 text-[13px] font-semibold text-brand-700 hover:underline"
            >
              Change
            </button>
          </div>
        ) : (
          <Field
            label="Which company?"
            required
            hint="Can’t find it? Type the exact name and add it anyway."
          >
            <div className="relative">
              <Search size={16} className="absolute left-3 top-3.5 text-ink-faint" />
              <input
                className="input pl-9"
                placeholder="Start typing a company name — e.g. Microsoft"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {searching && (
                <Loader2 size={15} className="absolute right-3 top-3.5 animate-spin text-ink-faint" />
              )}
            </div>

            {results.length > 0 && (
              <div className="mt-2 max-h-56 animate-slide-down overflow-y-auto rounded-xl border border-slate-200 shadow-card">
                {results.map((result, i) => (
                  <button
                    key={`${result.name}-${i}`}
                    type="button"
                    onClick={() => choose(result)}
                    className="flex w-full items-start gap-3 border-b border-slate-100 px-3.5 py-2.5 text-left transition last:border-0 hover:bg-brand-50"
                  >
                    <CompanyMark
                      name={result.name}
                      logoUrl={result.logoUrl}
                      fallbackUrl={result.logoFallbackUrl}
                    />
                    {/* Name, mark and domain - nothing else. The descriptions
                        these sources write are what made the list hard to read:
                        HDFC Bank, HDFC Life and HDFC ERGO are all "an Indian
                        financial services company", and it is the domain that
                        actually settles which one the rep meant. */}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline gap-2 text-sm font-medium text-ink">
                        <span className="truncate">{result.name}</span>
                        {result.ticker && (
                          <span className="shrink-0 font-mono text-2xs text-ink-faint">
                            {result.ticker}
                          </span>
                        )}
                      </p>
                      {result.website && (
                        <p className="truncate text-xs font-semibold text-brand-600">
                          {result.website}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Plenty of prospects have no public record to suggest from. Saying
                so beats an empty box that reads as a broken search. */}
            {!searching && !results.length && query.trim().length >= 2 && (
              <p className="mt-2 text-xs text-ink-muted">
                No matches for “{query.trim()}”. Add it anyway — we will research it from its
                name.
              </p>
            )}
          </Field>
        )}
      </div>
    </Modal>
  );
}
