import React, { useEffect, useState } from 'react';
import { Building2, Loader2, Search } from 'lucide-react';
import { apiError, companiesAPI } from '../services/api';
import { Alert, Button, Field, Modal } from '../components/ui';

interface SearchResult {
  _id?: string;
  name: string;
  ticker?: string;
  industry?: string;
  source?: string;
  snippet?: string;
  website?: string;
  logoUrl?: string;
  wikidataId?: string;
}

/**
 * The company's mark, or its initial while one loads and after one fails.
 *
 * A logo is the fastest way to tell the Microsoft you meant from the four
 * showcase pages that share its name, but the sources behind them - Wikimedia
 * Commons and site favicons - both 404 often enough that a broken image icon
 * would be a regular sight without this.
 */
function CompanyMark({ name, logoUrl }: { name: string; logoUrl?: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [logoUrl]);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-8 w-8 shrink-0 rounded-md border border-slate-200 bg-white object-contain p-0.5"
      />
    );
  }

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-ink-faint">
      {name?.trim()?.[0] || <Building2 size={14} />}
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
  onAdded: (result: { companyName: string; reportId?: string | null; reportError?: any }) => void;
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
        // enriches from this entity rather than searching the name again
        wikidataId: selected?.wikidataId || undefined,
        generateReport: true,
      });

      onAdded({
        companyName: res.data?.company?.name || name,
        reportId: res.data?.reportId,
        reportError: res.data?.reportError,
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
              <CompanyMark name={selected.name} logoUrl={selected.logoUrl} />
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{selected.name}</p>
                {/* Website first: it is the one line that confirms the right
                    HDFC was picked before a report is generated against it */}
                <p className="truncate text-xs text-ink-muted">
                  {[
                    selected.website,
                    selected.industry,
                    selected.source === 'local' ? 'Already in your list' : 'Found online',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
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
                    <CompanyMark name={result.name} logoUrl={result.logoUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline gap-2 text-sm font-medium text-ink">
                        <span className="truncate">{result.name}</span>
                        {result.ticker && (
                          <span className="shrink-0 font-mono text-2xs text-ink-faint">
                            {result.ticker}
                          </span>
                        )}
                      </p>
                      {(result.snippet || result.industry) && (
                        <p className="truncate text-xs text-ink-muted">
                          {result.industry || result.snippet}
                        </p>
                      )}
                      {/* The domain is what separates HDFC Bank from HDFC Life
                          from HDFC ERGO - their descriptions all read the same,
                          so it sits on its own line under the one it settles. */}
                      {result.website && (
                        <p className="mt-0.5 truncate text-xs font-semibold text-brand-600">
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
