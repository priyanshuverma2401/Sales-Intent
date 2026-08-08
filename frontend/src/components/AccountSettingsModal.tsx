import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  AccountPages,
  AccountTags,
  accountsAPI,
  apiError,
} from '../services/api';
import { Alert, Button, Field, Modal, cx } from './ui';

/**
 * Per-account crawl settings.
 *
 * Two kinds of thing live here. The URLs are pages we read directly and cannot
 * guess: Workday and iCIMS boards are only reachable through the tenant slug a
 * careers URL carries, and a company listed outside the US has results nowhere
 * but its own investor-relations page. The tags decide which of the narrow
 * crawls run at all - vertical trade press, regulator feeds, patents, federal
 * contracts - because each returns nothing for an account it does not apply to.
 *
 * Both are stored on the shared company record rather than per tenant. They are
 * facts about the prospect, not one customer's opinion of it, so whoever fills
 * one in has done the work for everyone watching the same account.
 */

interface Vertical {
  value: string;
  label: string;
  regulated: boolean;
}

const URL_FIELDS: {
  key: keyof AccountPages;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    key: 'careersUrl',
    label: 'Careers page',
    hint: 'The real job board URL. Greenhouse, Lever, Ashby, SmartRecruiters and Workday are read directly; Workday and iCIMS cannot be found without this.',
    placeholder: 'https://acme.wd5.myworkdayjobs.com/en-US/AcmeCareers',
  },
  {
    key: 'investorRelationsUrl',
    label: 'Investor relations',
    hint: 'Used for results when the company is not covered by SEC filings — anything listed outside the US.',
    placeholder: 'https://www.acme.com/investors',
  },
  {
    key: 'pressUrl',
    label: 'Newsroom / press releases',
    hint: 'First-party and usually first: senior hires are announced here before anyone reports them.',
    placeholder: 'https://www.acme.com/news',
  },
  {
    key: 'blogRssUrl',
    label: 'Blog RSS feed',
    hint: 'Discovered from the homepage automatically when it advertises one. Set it here if that misses.',
    placeholder: 'https://www.acme.com/blog/feed',
  },
  {
    key: 'linkedInPeopleUrl',
    label: 'LinkedIn people page',
    hint: 'Linked in the report for corroboration only — never fetched. LinkedIn publishes no free API and forbids scraping.',
    placeholder: 'https://www.linkedin.com/company/acme/people/',
  },
  {
    key: 'indeedUrl',
    label: 'Indeed company page',
    hint: 'Linked only, never fetched. The careers URL above is what actually produces the hiring numbers.',
    placeholder: 'https://www.indeed.com/cmp/acme',
  },
];

const FLAGS: { key: keyof AccountTags; label: string; hint: string }[] = [
  {
    key: 'regulated',
    label: 'Regulated industry',
    hint: 'Crawls regulator feeds — FCA, PRA, BaFin, AUSTRAC, Ofgem and the rest — and files regulatory triggers alongside named programmes.',
  },
  {
    key: 'governmentFacing',
    label: 'Sells to government',
    hint: 'Looks up US federal contract awards on USAspending.gov. US federal records only; other countries have no equivalent free register.',
  },
  {
    key: 'rndHeavy',
    label: 'R&D / IP heavy',
    hint: 'Searches USPTO for patents filed under this applicant. Needs a USPTO API key on the server.',
  },
];

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3.5 py-3 transition hover:border-brand-200 hover:bg-surface-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}

export default function AccountSettingsModal({
  open,
  account,
  onClose,
  onSaved,
}: {
  open: boolean;
  account: {
    _id: string;
    name: string;
    pages?: AccountPages;
    tags?: AccountTags;
  } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pages, setPages] = useState<AccountPages>({});
  const [tags, setTags] = useState<AccountTags>({});
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset from the account each time the dialog opens, so a cancelled edit
  // does not leak into the next account opened
  useEffect(() => {
    if (!open || !account) return;
    setPages({ ...(account.pages || {}) });
    setTags({ ...(account.tags || {}) });
    setError('');
  }, [open, account]);

  useEffect(() => {
    if (!open || verticals.length) return;
    accountsAPI
      .getVerticals()
      .then((res) => setVerticals(res.data || []))
      .catch(() => setVerticals([]));
  }, [open, verticals.length]);

  if (!account) return null;

  const save = async () => {
    setSaving(true);
    setError('');

    try {
      await accountsAPI.update(account._id, { pages, tags });
      onSaved();
      onClose();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  // Picking a regulated vertical turns the regulator crawl on, unless the user
  // has already said otherwise on this visit
  const pickVertical = (value: string) => {
    const spec = verticals.find((v) => v.value === value);
    setTags((current) => ({
      ...current,
      vertical: value || undefined,
      regulated: spec ? spec.regulated || current.regulated : current.regulated,
    }));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`${account.name} — account settings`}
      description="These steer what gets crawled for this account. They are shared with everyone in your workspace watching the same company."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} icon={saving ? Loader2 : undefined}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        {tags.autoTagged !== false && (
          <Alert tone="info">
            These were filled in automatically from the company&apos;s industry. Correct anything
            that is wrong — once you save, the automatic tagging leaves this account alone.
          </Alert>
        )}

        <div>
          <h3 className="mb-3 text-2xs font-bold uppercase tracking-[0.12em] text-brand-700">
            Industry
          </h3>
          <Field
            label="Vertical"
            hint="Decides which trade press we search. Leave it unset and the account still gets the cross-industry crawl."
          >
            <select
              className="input"
              value={tags.vertical || ''}
              onChange={(e) => pickVertical(e.target.value)}
            >
              <option value="">Not set</option>
              {verticals.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <h3 className="mb-3 text-2xs font-bold uppercase tracking-[0.12em] text-brand-700">
            Which crawls run
          </h3>
          <div className="space-y-2">
            {FLAGS.map((flag) => (
              <Toggle
                key={flag.key}
                label={flag.label}
                hint={flag.hint}
                checked={Boolean(tags[flag.key])}
                onChange={(value) => setTags((c) => ({ ...c, [flag.key]: value }))}
              />
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-2xs font-bold uppercase tracking-[0.12em] text-brand-700">
            Pages we read
          </h3>
          <div className="space-y-4">
            {URL_FIELDS.map((field) => (
              <Field key={field.key} label={field.label} hint={field.hint}>
                <input
                  className={cx('input')}
                  type="url"
                  placeholder={field.placeholder}
                  value={pages[field.key] || ''}
                  onChange={(e) =>
                    setPages((c) => ({ ...c, [field.key]: e.target.value }))
                  }
                />
              </Field>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
