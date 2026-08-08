import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Plus, Trash2 } from 'lucide-react';
import { alertsAPI, apiError, companiesAPI } from '../services/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SkeletonRows,
  stagger,
} from '../components/ui';

const TRIGGER_TYPES = [
  { value: 'all_signals', label: 'Anything new happens' },
  { value: 'signal_type', label: 'A particular kind of news' },
  { value: 'keyword', label: 'A word or phrase is mentioned' },
  { value: 'price_threshold', label: 'The share price passes a number' },
];

// Values are what the API stores; only the labels are written for a reader.
const ALERT_TYPES = [
  { value: 'signal', label: 'Any update' },
  { value: 'news', label: 'News' },
  { value: 'earnings', label: 'Earnings' },
  { value: 'hiring', label: 'Hiring' },
  { value: 'price_change', label: 'Share price change' },
  { value: 'custom', label: 'Something else' },
];

const TRIGGER_LABELS: Record<string, string> = Object.fromEntries(
  TRIGGER_TYPES.map((t) => [t.value, t.label])
);
const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  ALERT_TYPES.map((t) => [t.value, t.label])
);

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    companyId: '',
    title: '',
    type: 'signal',
    triggerType: 'all_signals',
    triggerValue: '',
  });

  const load = async () => {
    setLoading(true);
    const [a, c] = await Promise.allSettled([alertsAPI.getAlerts(), companiesAPI.getWatchlist()]);
    if (a.status === 'fulfilled') setAlerts(a.value.data);
    if (c.status === 'fulfilled') setCompanies(c.value.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const selected = companies.find((c: any) => c._id === form.companyId);
      await alertsAPI.createAlert({
        ...form,
        companyId: form.companyId || undefined,
        companyName: selected?.name,
        title: form.title || `Alert for ${selected?.name || 'all companies'}`,
      });

      setForm({ companyId: '', title: '', type: 'signal', triggerType: 'all_signals', triggerValue: '' });
      setModalOpen(false);
      load();
    } catch (err) {
      setError(apiError(err, 'Could not create the alert'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (id: string) => {
    try {
      await alertsAPI.toggleAlert(id);
      load();
    } catch (err) {
      setError(apiError(err, 'Could not update the alert'));
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this alert?')) return;
    try {
      await alertsAPI.deleteAlert(id);
      load();
    } catch (err) {
      setError(apiError(err, 'Could not delete the alert'));
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Automation"
        title="Alert rules"
        description="Tell us what to watch for, and we will flag it the moment it shows up."
        actions={
          <Button icon={Plus} onClick={() => setModalOpen(true)}>
            New alert
          </Button>
        }
      />

      {error && (
        <div className="mb-5">
          <Alert tone="error" onDismiss={() => setError('')}>
            {error}
          </Alert>
        </div>
      )}

      {loading ? (
        <SkeletonRows rows={3} />
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No alerts set up yet"
          description="Create a rule and we will tell you when one of your companies does something worth a call."
          action={
            <Button icon={Plus} onClick={() => setModalOpen(true)}>
              Create an alert
            </Button>
          }
        />
      ) : (
        <div className="stagger space-y-3">
          {alerts.map((alert, i) => (
            <Card
              key={alert._id}
              style={stagger(i)}
              className="flex items-start justify-between gap-4 p-5 hover:shadow-raised"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-bold text-ink">
                    {alert.title || alert.companyName || 'Untitled alert'}
                  </h3>
                  <Badge tone={alert.isActive ? 'green' : 'neutral'}>
                    {alert.isActive ? 'On' : 'Paused'}
                  </Badge>
                  <Badge tone="brand">{TYPE_LABELS[alert.type] || alert.type}</Badge>
                </div>
                <p className="mt-1.5 text-[13px] text-ink-muted">
                  Tells you when{' '}
                  <span className="font-medium text-ink-soft">
                    {(TRIGGER_LABELS[alert.triggerType] || TRIGGER_LABELS.all_signals).toLowerCase()}
                  </span>
                  {alert.triggerValue ? ` — “${alert.triggerValue}”` : ''}
                  {alert.companyName ? ` at ${alert.companyName}` : ' at any of your companies'}
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => toggle(alert._id)}
                  title={alert.isActive ? 'Pause this alert' : 'Turn this alert on'}
                  className="rounded-lg p-2 text-ink-faint transition hover:bg-slate-100 hover:text-ink active:scale-95"
                >
                  {alert.isActive ? <BellOff size={16} /> : <Bell size={16} />}
                </button>
                <button
                  onClick={() => remove(alert._id)}
                  title="Delete"
                  className="rounded-lg p-2 text-ink-faint transition hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 rounded-xl border border-slate-200/70 bg-surface/60 px-4 py-3 text-[13px] leading-relaxed text-ink-muted">
        Your alert rules are saved, but nothing checks them on a schedule yet — we gather updates
        when you choose “Check for news” on a company.
      </p>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create an alert"
        description="Tell us what to watch for across your companies."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create as any} loading={saving}>
              Create alert
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-5">
          <Field label="Which company?" hint="Leave this on “All my companies” to watch everything.">
            <select
              className="input"
              value={form.companyId}
              onChange={(e) => setForm({ ...form, companyId: e.target.value })}
            >
              <option value="">All my companies</option>
              {companies.map((c: any) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Give it a name" hint="Just so you can recognise it later.">
            <input
              className="input"
              placeholder="e.g. Earnings watch"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="What kind of update?">
              <select
                className="input"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {ALERT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Tell me when…">
              <select
                className="input"
                value={form.triggerType}
                onChange={(e) => setForm({ ...form, triggerType: e.target.value })}
              >
                {TRIGGER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {form.triggerType !== 'all_signals' && (
            <Field
              label={form.triggerType === 'price_threshold' ? 'Which price?' : 'Which word or phrase?'}
            >
              <input
                className="input"
                placeholder={form.triggerType === 'price_threshold' ? 'e.g. 250' : 'e.g. acquisition'}
                value={form.triggerValue}
                onChange={(e) => setForm({ ...form, triggerValue: e.target.value })}
              />
            </Field>
          )}
        </form>
      </Modal>
    </div>
  );
}
