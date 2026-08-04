import React, { useEffect, useState } from 'react';
import { Bell, ExternalLink, Sparkles } from 'lucide-react';
import { signalsAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Badge, EmptyState, PageHeader, SkeletonRows, cx } from '../components/ui';

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
  const { user } = useAuthStore();
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

  const keywords = user?.profile?.keywords || [];

  // Surface the ones that mention what the rep is pitching — those are the
  // signals worth acting on today.
  const matchesLens = (signal: any) => {
    if (!keywords.length) return false;
    const text = `${signal.title || ''} ${signal.description || ''}`.toLowerCase();
    return keywords.some((k) => text.includes(k.toLowerCase().replace(/\s+solutions?$/, '')));
  };

  return (
    <div>
      <PageHeader
        eyebrow="Live"
        title="Signals"
        description="Events picked up across your accounts in the last 30 days."
      />

      <div className="mb-6 flex flex-wrap gap-1.5">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={cx(
              'rounded-lg px-3 py-1.5 text-[13px] font-semibold capitalize transition',
              filter === cat
                ? 'bg-brand-600 text-white'
                : 'bg-surface text-ink-muted ring-1 ring-slate-200 hover:bg-slate-50 hover:text-ink'
            )}
          >
            {cat === 'ma' ? 'M&A' : cat}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows rows={4} />
      ) : signals.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No signals yet"
          description="Refresh an account to pull fresh news, filings and hiring activity."
        />
      ) : (
        <div className="space-y-3">
          {signals.map((signal) => {
            const hit = matchesLens(signal);

            return (
              <article
                key={signal._id}
                className={cx('card card-pad', hit && 'ring-1 ring-brand-200')}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-bold text-ink">{signal.companyName}</span>
                  {signal.ticker && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-2xs font-semibold text-ink-muted">
                      {signal.ticker}
                    </span>
                  )}
                  <Badge tone="neutral">{signal.type}</Badge>
                  <Badge tone={PRIORITY_TONE[signal.priority] || 'neutral'}>{signal.priority}</Badge>
                  {hit && (
                    <Badge tone="brand">
                      <Sparkles size={10} /> Matches your pitch
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
                  <div className="mt-3 rounded-lg border-l-[3px] border-brand-500 bg-brand-50/60 px-4 py-3">
                    <p className="mb-1 text-2xs font-bold uppercase tracking-wider text-brand-700">
                      Analysis
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
                    className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-600 hover:text-brand-700"
                  >
                    Read the source <ExternalLink size={12} />
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
