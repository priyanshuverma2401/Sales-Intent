import React, { useEffect, useState } from 'react';
import { Bell, ExternalLink, Sparkles } from 'lucide-react';
import { signalsAPI } from '../services/api';
import { useAuthStore, focusTopics } from '../store/authStore';
import { Badge, EmptyState, PageHeader, SkeletonRows, cx, stagger } from '../components/ui';

// Plain-English names for the category filter. The values are what the API
// stores, so only the label changes.
const CATEGORY_LABELS: Record<string, string> = {
  all: 'Everything',
  news: 'News',
  earnings: 'Earnings',
  hiring: 'Hiring',
  executive: 'Leadership changes',
  funding: 'Funding',
  ma: 'Mergers & acquisitions',
  partnership: 'Partnerships',
  product: 'Product launches',
  regulation: 'Regulation',
};

const CATEGORIES = [
  'all',
  'news',
  'earnings',
  'hiring',
  'executive',
  'funding',
  'ma',
  'partnership',
  'product',
  'regulation',
];

const PRIORITY_TONE: Record<string, 'red' | 'amber' | 'green' | 'neutral'> = {
  critical: 'red',
  high: 'red',
  medium: 'amber',
  low: 'green',
};

export default function SignalsPage() {
  const { organization } = useAuthStore();
  const [signals, setSignals] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    signalsAPI
      .getSignals(30, filter !== 'all' ? filter : undefined)
      .then((res) => setSignals(res.data))
      .catch(() => setSignals([]))
      .finally(() => setLoading(false));
  }, [filter]);

  // High-priority topics only: the point of the flag is that a signal touching
  // one of them is worth acting on today, and marking everything marks nothing.
  const { high: priorityTopics, all: allTopics } = focusTopics(organization);
  const lens = priorityTopics.length ? priorityTopics : allTopics;

  const matchesLens = (signal: any) => {
    if (!lens.length) return false;
    const text = `${signal.title || ''} ${signal.description || ''}`.toLowerCase();
    return lens.some((topic) => text.includes(topic.toLowerCase().replace(/\s+solutions?$/, '')));
  };

  return (
    <div>
      <PageHeader
        eyebrow="Live"
        title="Buying signals"
        description="Things that happened at your companies in the last 30 days — the moments worth a call."
      />

      <div className="mb-6 flex flex-wrap gap-1.5">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={cx(
              'rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all duration-200 ease-swift active:scale-95',
              filter === cat
                ? 'bg-brand-gradient text-white shadow-brand'
                : 'bg-surface text-ink-muted shadow-card ring-1 ring-slate-200 hover:-translate-y-px hover:text-ink hover:shadow-raised'
            )}
          >
            {CATEGORY_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows rows={4} />
      ) : signals.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nothing here yet"
          description="Open a company and choose “Check for news” — we will pull in the latest news, filings and hiring activity."
        />
      ) : (
        <div className="stagger space-y-3">
          {signals.map((signal, i) => {
            const hit = matchesLens(signal);

            return (
              <article
                key={signal._id}
                style={stagger(i)}
                className={cx(
                  'card card-pad hover:shadow-raised',
                  hit && 'border-brand-200 ring-1 ring-brand-200'
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-bold text-ink">{signal.companyName}</span>
                  {signal.ticker && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-2xs font-semibold text-ink-muted">
                      {signal.ticker}
                    </span>
                  )}
                  <Badge tone="neutral">{CATEGORY_LABELS[signal.type] || signal.type}</Badge>
                  <Badge tone={PRIORITY_TONE[signal.priority] || 'neutral'}>
                    {signal.priority === 'critical' || signal.priority === 'high'
                      ? 'Act now'
                      : signal.priority === 'medium'
                      ? 'Worth a look'
                      : 'Background'}
                  </Badge>
                  {hit && (
                    <Badge tone="brand">
                      <Sparkles size={10} /> Matches what you sell
                    </Badge>
                  )}
                  <span className="ml-auto text-2xs text-ink-faint">
                    {signal.publishedAt && !isNaN(new Date(signal.publishedAt).getTime())
                      ? new Date(signal.publishedAt).toLocaleDateString()
                      : ''}
                  </span>
                </div>

                <h2 className="mt-2 text-[15px] font-bold leading-snug tracking-tight text-ink">
                  {signal.title}
                </h2>

                {signal.description && (
                  <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-ink-soft">
                    {signal.description.replace(/<[^>]*>/g, '')}
                  </p>
                )}

                {signal.aiAnalysis?.summary && (
                  <div className="mt-3.5 rounded-xl border-l-[3px] border-brand-500 bg-brand-50/70 px-4 py-3">
                    <p className="eyebrow mb-1.5 flex items-center gap-1.5 text-brand-700">
                      <Sparkles size={11} /> What this means for you
                    </p>
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-brand-900/80">
                      {signal.aiAnalysis.summary}
                    </p>
                  </div>
                )}

                {signal.sourceUrl && (
                  <a
                    href={signal.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-600 transition hover:text-brand-700"
                  >
                    Read the full story <ExternalLink size={12} />
                  </a>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
