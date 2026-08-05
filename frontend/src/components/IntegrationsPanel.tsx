import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Link2,
  Plug,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { apiError, integrationsAPI } from '../services/api';
import { Alert, Badge, Button, Card, Field, Modal, Spinner, cx } from './ui';

// CRM integrations. Connecting one makes every report, signal and score for this
// tenant use its own pipeline data alongside the public evidence.

type Provider = 'salesforce' | 'zoho';

type Connection = {
  _id: string;
  provider: Provider;
  status: 'connected' | 'error' | 'disconnected';
  connectedAccount?: string;
  connectedByName?: string;
  clientId?: string;
  loginUrl?: string;
  instanceUrl?: string;
  apiDomain?: string;
  usage?: { reports?: boolean; signals?: boolean; score?: boolean };
  freshnessHours?: number;
  lastSyncAt?: string;
  lastSyncStatus?: 'ok' | 'partial' | 'failed';
  lastSyncError?: string;
  lastSyncCounts?: {
    accountsMatched?: number;
    accountsMissing?: number;
    opportunities?: number;
    contacts?: number;
    activities?: number;
    signalsCreated?: number;
  };
};

const PROVIDER_META: Record<
  Provider,
  { label: string; blurb: string; docs: string; hostLabel: string; hostHint: string; hostDefault: string }
> = {
  salesforce: {
    label: 'Salesforce',
    blurb: 'Accounts, opportunities, contacts and tasks from your Salesforce org.',
    docs: 'Create a connected app with the api and refresh_token scopes, then authorise it once to get a refresh token.',
    hostLabel: 'Login URL',
    hostHint: 'Use https://test.salesforce.com for a sandbox, or your My Domain URL.',
    hostDefault: 'https://login.salesforce.com',
  },
  zoho: {
    label: 'Zoho CRM',
    blurb: 'Accounts, deals, contacts, notes and tasks from your Zoho CRM.',
    docs: 'Create a Self Client in the Zoho API console with ZohoCRM.modules.ALL and ZohoCRM.org.READ, then exchange the code for a refresh token.',
    hostLabel: 'Accounts URL',
    hostHint: 'Region-specific: .com, .eu, .in or .com.au — a token from the wrong region will not work.',
    hostDefault: 'https://accounts.zoho.com',
  },
};

function formatDate(value?: string) {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'never';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function IntegrationsPanel({
  canEdit,
  onMessage,
}: {
  canEdit: boolean;
  onMessage: (message: { tone: 'success' | 'error'; text: string }) => void;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [matchedAccounts, setMatchedAccounts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>('');
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const [disconnecting, setDisconnecting] = useState<Connection | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await integrationsAPI.get();
      setConnections(res.data?.connections || []);
      setMatchedAccounts(res.data?.matchedAccounts || 0);
    } catch {
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const connectionFor = (provider: Provider) => connections.find((c) => c.provider === provider);

  const run = async (label: string, action: () => Promise<any>, success: string) => {
    setBusy(label);
    try {
      const res = await action();
      onMessage({ tone: 'success', text: res?.data?.message || success });
      await load();
    } catch (err) {
      onMessage({ tone: 'error', text: apiError(err, 'That did not work') });
    } finally {
      setBusy('');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      {!canEdit && (
        <Alert tone="info">Only owners and admins can connect or configure a CRM.</Alert>
      )}

      <Card className="card-pad">
        <h2 className="text-lg font-bold tracking-tight text-ink">Connect your CRM</h2>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-muted">
          Public evidence tells you what is happening at an account. Your CRM tells you where you
          already stand with it. Connect one and every report is written to your real position —
          open deals get an advance plan, customers get an expansion plan, and a stalled deal with
          no recent activity becomes a signal instead of a surprise.
        </p>

        <ul className="mt-4 space-y-1.5 text-[13px] text-ink-muted">
          <li>
            <strong className="text-ink">Reports</strong> quote your open pipeline, stages, next
            steps, account owner and known contacts, and are told never to treat a live account as a
            cold prospect.
          </li>
          <li>
            <strong className="text-ink">Signals</strong> are raised for new deals, stage changes,
            closed-won/lost, new contacts, and deals that have gone quiet.
          </li>
          <li>
            <strong className="text-ink">Score</strong> gains a CRM component worth 15 points —
            pipeline value, engagement recency and relationship depth — with the public components
            rebalanced so the total is still out of 100.
          </li>
        </ul>

        {matchedAccounts > 0 && (
          <p className="mt-4 text-[13px] font-medium text-ink">
            {matchedAccounts} of your accounts are currently matched in the CRM.
          </p>
        )}
      </Card>

      {(Object.keys(PROVIDER_META) as Provider[]).map((provider) => {
        const meta = PROVIDER_META[provider];
        const connection = connectionFor(provider);

        return (
          <Card key={provider} className="card-pad">
            <div className="flex flex-wrap items-start gap-4">
              <span
                className={cx(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                  connection ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-ink-faint'
                )}
              >
                <Cloud size={22} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-ink">{meta.label}</h3>
                  {connection ? (
                    connection.status === 'error' ? (
                      <Badge tone="red">Needs reconnecting</Badge>
                    ) : (
                      <Badge tone="green">Connected</Badge>
                    )
                  ) : (
                    <Badge tone="neutral">Not connected</Badge>
                  )}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{meta.blurb}</p>

                {connection && (
                  <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2">
                    <Detail label="CRM account" value={connection.connectedAccount || '—'} />
                    <Detail
                      label="Endpoint"
                      value={connection.instanceUrl || connection.apiDomain || '—'}
                    />
                    <Detail label="Connected by" value={connection.connectedByName || '—'} />
                    <Detail label="Last sync" value={formatDate(connection.lastSyncAt)} />
                  </dl>
                )}

                {connection?.lastSyncCounts && connection.lastSyncAt && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Stat label="matched" value={connection.lastSyncCounts.accountsMatched} />
                    <Stat label="not in CRM" value={connection.lastSyncCounts.accountsMissing} />
                    <Stat label="opportunities" value={connection.lastSyncCounts.opportunities} />
                    <Stat label="contacts" value={connection.lastSyncCounts.contacts} />
                    <Stat label="signals raised" value={connection.lastSyncCounts.signalsCreated} />
                  </div>
                )}

                {connection?.lastSyncError && (
                  <p className="mt-3 flex items-start gap-1.5 text-[13px] text-red-600">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    {connection.lastSyncError}
                  </p>
                )}
              </div>

              {canEdit && (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {connection ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Link2}
                        loading={busy === `test-${provider}`}
                        onClick={() =>
                          run(
                            `test-${provider}`,
                            () => integrationsAPI.test(provider),
                            'Connection is healthy'
                          )
                        }
                      >
                        Test
                      </Button>
                      <Button
                        size="sm"
                        icon={RefreshCw}
                        loading={busy === `sync-${provider}`}
                        onClick={() =>
                          run(`sync-${provider}`, () => integrationsAPI.sync(provider), 'Sync started')
                        }
                      >
                        Sync now
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={Trash2}
                        onClick={() => setDisconnecting(connection)}
                      >
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button icon={Plug} onClick={() => setConnecting(provider)}>
                      Connect
                    </Button>
                  )}
                </div>
              )}
            </div>

            {connection && canEdit && (
              <UsageControls
                connection={connection}
                onSaved={(text) => {
                  onMessage({ tone: 'success', text });
                  load();
                }}
                onError={(text) => onMessage({ tone: 'error', text })}
              />
            )}
          </Card>
        );
      })}

      {connecting && (
        <ConnectModal
          provider={connecting}
          onClose={() => setConnecting(null)}
          onError={(text) => onMessage({ tone: 'error', text })}
          onConnected={(text) => {
            setConnecting(null);
            onMessage({ tone: 'success', text });
            load();
          }}
        />
      )}

      {disconnecting && (
        <DisconnectModal
          connection={disconnecting}
          onClose={() => setDisconnecting(null)}
          onError={(text) => onMessage({ tone: 'error', text })}
          onDisconnected={(text) => {
            setDisconnecting(null);
            onMessage({ tone: 'success', text });
            load();
          }}
        />
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-bold uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-ink-soft">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  if (value === undefined || value === null) return null;
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-2xs font-semibold text-ink-muted">
      {value} {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// What the CRM is allowed to influence
// ---------------------------------------------------------------------------
function UsageControls({
  connection,
  onSaved,
  onError,
}: {
  connection: Connection;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [usage, setUsage] = useState({
    reports: connection.usage?.reports !== false,
    signals: connection.usage?.signals !== false,
    score: connection.usage?.score !== false,
  });
  const [freshness, setFreshness] = useState(connection.freshnessHours || 24);
  const [saving, setSaving] = useState(false);

  const dirty =
    usage.reports !== (connection.usage?.reports !== false) ||
    usage.signals !== (connection.usage?.signals !== false) ||
    usage.score !== (connection.usage?.score !== false) ||
    freshness !== (connection.freshnessHours || 24);

  const save = async () => {
    setSaving(true);
    try {
      await integrationsAPI.update(connection.provider, { usage, freshnessHours: freshness });
      onSaved('Integration settings saved.');
    } catch (err) {
      onError(apiError(err, 'Could not save the integration settings'));
    } finally {
      setSaving(false);
    }
  };

  const toggles: { key: keyof typeof usage; label: string; hint: string }[] = [
    { key: 'reports', label: 'Use in reports', hint: 'Pipeline, contacts and activity in the prompt' },
    { key: 'signals', label: 'Raise signals', hint: 'New deals, stage changes, stalled deals' },
    { key: 'score', label: 'Use in scoring', hint: 'Adds the 15-point CRM component' },
  ];

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {toggles.map(({ key, label, hint }) => (
          <label key={key} className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
              checked={usage[key]}
              onChange={(e) => setUsage({ ...usage, [key]: e.target.checked })}
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-ink">{label}</span>
              <span className="block text-2xs text-ink-muted">{hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] text-ink-muted">
          Refresh an account's CRM data after
          <input
            type="number"
            min={1}
            max={720}
            value={freshness}
            onChange={(e) => setFreshness(Number(e.target.value))}
            className="w-20 rounded-md border border-slate-300 bg-surface px-2 py-1 text-[13px] text-ink"
          />
          hours
        </label>

        <Button size="sm" disabled={!dirty} loading={saving} onClick={save}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------
function ConnectModal({
  provider,
  onClose,
  onConnected,
  onError,
}: {
  provider: Provider;
  onClose: () => void;
  onConnected: (message: string) => void;
  onError: (message: string) => void;
}) {
  const meta = PROVIDER_META[provider];
  const [form, setForm] = useState({
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    host: meta.hostDefault,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!form.clientId.trim() || !form.clientSecret.trim() || !form.refreshToken.trim()) {
      setError('Client ID, client secret and refresh token are all required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await integrationsAPI.connect(provider, {
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret.trim(),
        refreshToken: form.refreshToken.trim(),
        ...(provider === 'salesforce'
          ? { loginUrl: form.host.trim() }
          : { accountsUrl: form.host.trim() }),
      });
      onConnected(res.data?.message || `${meta.label} connected`);
    } catch (err) {
      // The server proves the credentials against the CRM before saving, so this
      // message is the CRM's own rejection reason
      const text = apiError(err, 'Could not connect');
      setError(text);
      onError(text);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Connect ${meta.label}`}
      description={meta.docs}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={CheckCircle2} loading={saving} onClick={submit}>
            Verify and connect
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        <Alert tone="info">
          Credentials are verified against {meta.label} before anything is stored, and the secret and
          refresh token are encrypted at rest. They are never sent back to the browser.
        </Alert>

        <Field label={meta.hostLabel} hint={meta.hostHint}>
          <input
            className="input"
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
          />
        </Field>

        <Field label="Client ID" required>
          <input
            className="input"
            autoFocus
            value={form.clientId}
            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
          />
        </Field>

        <Field label="Client secret" required>
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={form.clientSecret}
            onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
          />
        </Field>

        <Field label="Refresh token" required hint="Issued once when you authorise the app.">
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={form.refreshToken}
            onChange={(e) => setForm({ ...form, refreshToken: e.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}

function DisconnectModal({
  connection,
  onClose,
  onDisconnected,
  onError,
}: {
  connection: Connection;
  onClose: () => void;
  onDisconnected: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const meta = PROVIDER_META[connection.provider];

  const submit = async () => {
    setSaving(true);
    try {
      const res = await integrationsAPI.disconnect(connection.provider);
      onDisconnected(res.data?.message || `${meta.label} disconnected`);
    } catch (err) {
      onError(apiError(err, 'Could not disconnect'));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Disconnect ${meta.label}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={saving} onClick={submit}>
            Disconnect
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        The stored credentials and every cached CRM snapshot are deleted, and new reports go back to
        public evidence only. Signals already raised from the CRM stay — they describe things that
        did happen. You can reconnect at any time.
      </p>
    </Modal>
  );
}
