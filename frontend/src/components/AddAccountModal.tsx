import React, { useEffect, useState } from 'react';
import { Building2, Loader2, Search } from 'lucide-react';
import { apiError, companiesAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Alert, Button, Field, Modal } from '../components/ui';

interface SearchResult {
  _id?: string;
  name: string;
  ticker?: string;
  industry?: string;
  source?: string;
  snippet?: string;
}

/**
 * Adding an account asks for one thing: the company. The pitch lens comes from
 * the rep's profile keywords, and the ticker is taken from the search hit when
 * there is one — neither is worth a field here.
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
  const { user } = useAuthStore();
  const profileKeywords = user?.profile?.keywords || [];

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
        keywords: profileKeywords,
        generateReport: true,
      });

      onAdded({
        companyName: res.data?.company?.name || name,
        reportId: res.data?.reportId,
        reportError: res.data?.reportError,
      });
      onClose();
    } catch (err) {
      setError(apiError(err, 'Could not add this account'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add an account"
      description="Search for the company you want to add."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting} disabled={!selected && query.trim().length < 2}>
            Add &amp; generate report
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        {/* ---- Company ---- */}
        {selected ? (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
            <div className="flex min-w-0 gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white">
                <Building2 size={17} className="text-brand-600" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{selected.name}</p>
                <p className="truncate text-xs text-ink-muted">
                  {[selected.industry, selected.source === 'local' ? 'In your library' : 'Public data']
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
          <Field label="Company" required hint="Can’t find it? Type the exact name and add it anyway.">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-3.5 text-ink-faint" />
              <input
                className="input pl-9"
                placeholder="Search companies — e.g. Microsoft"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {searching && (
                <Loader2 size={15} className="absolute right-3 top-3.5 animate-spin text-ink-faint" />
              )}
            </div>

            {results.length > 0 && (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                {results.map((result, i) => (
                  <button
                    key={`${result.name}-${i}`}
                    type="button"
                    onClick={() => choose(result)}
                    className="flex w-full items-start gap-3 border-b border-slate-100 px-3.5 py-2.5 text-left transition last:border-0 hover:bg-slate-50"
                  >
                    <Building2 size={15} className="mt-0.5 shrink-0 text-ink-faint" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {result.name}
                        {result.ticker && (
                          <span className="ml-2 font-mono text-2xs text-ink-faint">
                            {result.ticker}
                          </span>
                        )}
                      </p>
                      {(result.snippet || result.industry) && (
                        <p className="truncate text-xs text-ink-muted">
                          {result.industry || result.snippet}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Field>
        )}
      </div>
    </Modal>
  );
}
