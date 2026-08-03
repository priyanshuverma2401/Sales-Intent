import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Plus, Trash2 } from 'lucide-react';
import { alertsAPI, apiError, companiesAPI } from '../services/api';
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, SkeletonRows } from '../components/ui';

const TRIGGER_TYPES = [
  { value: 'all_signals', label: 'Any new signal' },
  { value: 'signal_type', label: 'Specific signal type' },
  { value: 'keyword', label: 'Keyword match' },
  { value: 'price_threshold', label: 'Price threshold' },
];

const ALERT_TYPES = ['signal', 'news', 'earnings', 'hiring', 'price_change', 'custom'];

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
        title: form.title || `Alert for ${selected?.name || 'all accounts'}`,
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
        title="Alerts"
        description="Rules that flag the account events you care about."
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
          title="No alerts configured"
          description="Create a rule to be told when an account does something worth a call."
          action={
            <Button icon={Plus} onClick={() => setModalOpen(true)}>
              Create an alert
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <Card key={alert._id} className="flex items-start justify-between gap-4 p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-bold text-ink">
                    {alert.title || alert.companyName || 'Untitled alert'}
                  </h3>
                  <Badge tone={alert.isActive ? 'green' : 'neutral'}>
                    {alert.isActive ? 'Active' : 'Paused'}
                  </Badge>
                  <Badge tone="brand">{alert.type}</Badge>
                </div>
                <p className="mt-1.5 text-[13px] text-ink-muted">
                  Trigger: {alert.triggerType || 'all_signals'}
                  {alert.triggerValue ? ` — ${alert.triggerValue}` : ''}
                  {alert.companyName ? ` · ${alert.companyName}` : ' · all accounts'}
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => toggle(alert._id)}
                  title={alert.isActive ? 'Pause' : 'Activate'}
                  className="rounded-lg p-2 text-ink-faint transition hover:bg-slate-100 hover:text-ink"
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

      <p className="mt-6 text-[13px] text-ink-muted">
        Alerts are stored here, but nothing evaluates them on a schedule yet — signals are collected
        when you refresh an account.
      </p>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create an alert"
        description="Tell us what to watch for across your accounts."
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
          <Field label="Account">
            <select
              className="input"
              value={form.companyId}
              onChange={(e) => setForm({ ...form, companyId: e.target.value })}
            >
              <option value="">All accounts</option>
              {companies.map((c: any) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Alert name">
            <input
              className="input"
              placeholder="e.g. Earnings watch"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Category">
              <select
                className="input"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {ALERT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Trigger">
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
            <Field label="Trigger value">
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
