import React, { useEffect, useState } from 'react';
import { Building2, Loader2, Search, Sparkles } from 'lucide-react';
import { apiError, companiesAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Alert, Button, Field, Modal, TagInput, cx } from '../components/ui';
import { KEYWORD_SUGGESTIONS } from '../lib/taxonomy';

interface SearchResult {
  _id?: string;
  name: string;
  ticker?: string;
  industry?: string;
  source?: string;
  snippet?: string;
}

/**
 * Adding an account is the moment the pitch lens is chosen. The keyword field
 * defaults to the rep's profile keywords but can be overridden per account, so
 * one rep can chase Copilot at Microsoft and cost-takeout at HSBC.
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

  const [ticker, setTicker] = useState('');
  const [keywords, setKeywords] = useState<string[]>(profileKeywords);
  const [notes, setNotes] = useState('');
  const [generateReport, setGenerateReport] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset to a clean slate each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setSelected(null);
    setTicker('');
    setKeywords(profileKeywords);
    setNotes('');
    setGenerateReport(true);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setTicker(result.ticker || '');
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
        ticker: ticker.trim() || undefined,
        keywords,
        notes: notes.trim() || undefined,
        generateReport,
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

  const usingProfileDefaults =
    keywords.length === profileKeywords.length &&
    keywords.every((k, i) => k === profileKeywords[i]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add an account"
      description="Search for the company, then confirm what you are pitching into it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting} disabled={!selected && query.trim().length < 2}>
            {generateReport ? 'Add & generate report' : 'Add account'}
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
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface">
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

        {/* ---- Ticker ---- */}
        <Field label="Ticker" hint="Optional. Unlocks financial data and SEC filings in the report.">
          <input
            className="input font-mono uppercase"
            placeholder="MSFT"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
          />
        </Field>

        {/* ---- The lens ---- */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={15} className="text-brand-600" />
            <h3 className="text-sm font-bold text-ink">What are you pitching here?</h3>
          </div>
          <p className="mb-3 text-[13px] leading-relaxed text-ink-muted">
            The report is written to answer{' '}
            <span className="font-medium text-ink-soft">
              “where does {selected?.name || 'this company'} need{' '}
              {keywords.length ? keywords.join(' and ') : 'what I sell'}?”
            </span>
          </p>

          <TagInput
            value={keywords}
            onChange={setKeywords}
            placeholder="e.g. GenAI solutions, Copilot solutions"
            suggestions={[...profileKeywords, ...KEYWORD_SUGGESTIONS]}
          />

          <p className="mt-2 text-xs text-ink-muted">
            {usingProfileDefaults && keywords.length > 0
              ? 'Using your profile defaults. Edit above to focus this account differently.'
              : keywords.length === 0
              ? 'No keywords — the report will fall back to your vertical capabilities.'
              : 'Custom focus for this account only. Your profile stays unchanged.'}
          </p>
        </div>

        <Field label="Notes" hint="Context only you see — deal stage, contacts, history.">
          <textarea
            className="input"
            rows={2}
            placeholder="Intro via Priya in Sept. Renewal cycle starts Q1."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <label
          className={cx(
            'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition',
            generateReport ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-surface'
          )}
        >
          <input
            type="checkbox"
            checked={generateReport}
            onChange={(e) => setGenerateReport(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-[13px]">
            <span className="block font-semibold text-ink">Generate the report now</span>
            <span className="block text-ink-muted">
              Takes about a minute. We’ll notify you in your inbox when it’s ready.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
