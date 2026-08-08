import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { apiError, apiKeysAPI, PUBLIC_API_URL } from '../services/api';
import { Alert, Badge, Button, Card, Field, Modal, Spinner, cx } from './ui';

// API keys for the public read API. A key is shown once, at creation: the
// server only ever stores a digest, so there is no "show key" action to add.

type ApiKeyRow = {
  _id: string;
  name: string;
  prefix?: string;
  last4?: string;
  createdByName?: string;
  createdAt?: string;
  lastUsedAt?: string;
  requestCount?: number;
  revokedAt?: string;
};

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function CopyButton({
  value,
  label = 'Copy',
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          // Clipboard is unavailable on insecure origins
        }
      }}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1 text-[12px] font-semibold text-ink-soft transition hover:bg-slate-50',
        className
      )}
    >
      {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export default function ApiKeysPanel({
  canEdit,
  onMessage,
}: {
  canEdit: boolean;
  onMessage: (message: { tone: 'success' | 'error'; text: string }) => void;
}) {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiKeysAPI.list();
      setKeys(res.data || []);
    } catch {
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sample = `curl -H "X-API-Key: sm_live_..." \\\n  "${PUBLIC_API_URL}/reports?company=HSBC"`;

  return (
    <div className="space-y-5">
      {!canEdit && (
        <Alert tone="info">Only owners and admins can create or revoke API keys.</Alert>
      )}

      <Card className="card-pad">
        <h2 className="text-lg font-bold tracking-tight text-ink">What the API returns</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          Ask for an account by name. If your company has generated a report for it, you get the
          full report content, the rendered PDF as base64, and that account's signals — in one JSON
          response.
        </p>

        <div className="mt-4 overflow-x-auto rounded-lg bg-navy-900 p-4">
          <pre className="whitespace-pre text-[12.5px] leading-relaxed text-brand-100">{sample}</pre>
        </div>
        <div className="mt-2 flex justify-end">
          <CopyButton value={sample} label="Copy example" />
        </div>

        <dl className="mt-5 space-y-3 text-[13px]">
          <Endpoint
            method="GET"
            path="/v1/reports?company=NAME"
            detail="The report, its PDF and the account's signals. Add &includePdf=false for a smaller response, &signals=50 to cap the signal list, &days=30 to only take recent signals."
          />
          <Endpoint method="GET" path="/v1/accounts" detail="Every account your company has added." />
          <Endpoint method="GET" path="/v1/ping" detail="Check that a key works." />
        </dl>

        <h3 className="mt-6 text-sm font-bold text-ink">Errors</h3>
        <ul className="mt-2 space-y-1.5 text-[13px] text-ink-muted">
          <ErrorRow code="COMPANY_NOT_FOUND" status="404" detail="No company by that name exists." />
          <ErrorRow
            code="ACCOUNT_NOT_ADDED"
            status="404"
            detail="The company exists but is not one of your accounts — add it first."
          />
          <ErrorRow
            code="REPORT_NOT_FOUND"
            status="404"
            detail="It is your account, but no report has been generated yet."
          />
          <ErrorRow
            code="REPORT_PENDING"
            status="409"
            detail="A report is generating right now. Retry shortly."
          />
          <ErrorRow code="INVALID_API_KEY" status="401" detail="The key is wrong or revoked." />
        </ul>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-6 py-5">
          <h2 className="text-lg font-bold tracking-tight text-ink">API keys</h2>
          <Badge tone="neutral">{keys.filter((k) => !k.revokedAt).length} active</Badge>
          {canEdit && (
            <Button className="ml-auto" icon={Plus} onClick={() => setCreating(true)}>
              Create API key
            </Button>
          )}
        </div>

        {loading ? (
          <Spinner />
        ) : keys.length === 0 ? (
          <p className="border-t border-slate-100 px-6 py-10 text-center text-sm text-ink-muted">
            No API keys yet. Create one to start calling the API.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="border-y border-slate-100 bg-surface-2 text-[13px] font-semibold text-ink-muted">
                <tr>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Key</th>
                  <th className="px-6 py-3">Created</th>
                  <th className="px-6 py-3">Last used</th>
                  <th className="px-6 py-3">Calls</th>
                  <th className="w-16 px-6 py-3" />
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {keys.map((key) => (
                  <tr key={key._id} className={cx('hover:bg-slate-50', key.revokedAt && 'opacity-60')}>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <KeyRound size={15} className="shrink-0 text-ink-faint" />
                        <span className="text-sm font-medium text-ink">{key.name}</span>
                        {key.revokedAt && <Badge tone="red">Revoked</Badge>}
                      </div>
                      {key.createdByName && (
                        <p className="mt-0.5 pl-[23px] text-2xs text-ink-faint">
                          by {key.createdByName}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12.5px] text-ink-soft">
                        {key.prefix}…{key.last4}
                      </code>
                    </td>
                    <td className="px-6 py-3.5 text-[13px] text-ink-soft">
                      {formatDate(key.createdAt)}
                    </td>
                    <td className="px-6 py-3.5 text-[13px] text-ink-soft">
                      {formatDate(key.lastUsedAt)}
                    </td>
                    <td className="px-6 py-3.5 text-[13px] text-ink-soft">
                      {key.requestCount ?? 0}
                    </td>
                    <td className="px-6 py-3.5">
                      {canEdit && !key.revokedAt && (
                        <button
                          type="button"
                          onClick={() => setRevoking(key)}
                          aria-label={`Revoke ${key.name}`}
                          title="Revoke key"
                          className="rounded-lg p-1.5 text-red-600 transition hover:bg-red-50"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <CreateKeyModal
          onClose={() => setCreating(false)}
          onError={(text) => onMessage({ tone: 'error', text })}
          onCreated={() => {
            setCreating(false);
            load();
            onMessage({ tone: 'success', text: 'API key created.' });
          }}
        />
      )}

      {revoking && (
        <RevokeKeyModal
          apiKey={revoking}
          onClose={() => setRevoking(null)}
          onError={(text) => onMessage({ tone: 'error', text })}
          onRevoked={() => {
            const name = revoking.name;
            setRevoking(null);
            load();
            onMessage({ tone: 'success', text: `${name} was revoked.` });
          }}
        />
      )}
    </div>
  );
}

function Endpoint({ method, path, detail }: { method: string; path: string; detail: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="flex items-baseline gap-2">
        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-2xs font-bold text-emerald-700">
          {method}
        </span>
        <code className="text-[12.5px] font-semibold text-ink">{path}</code>
      </dt>
      <dd className="min-w-0 flex-1 text-ink-muted">{detail}</dd>
    </div>
  );
}

function ErrorRow({ code, status, detail }: { code: string; status: string; detail: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] font-semibold text-ink-soft">
        {status} {code}
      </code>
      <span className="min-w-0 flex-1">{detail}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Create - the one and only time the plaintext key exists in the browser
// ---------------------------------------------------------------------------
function CreateKeyModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState('');

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the key a name so you can recognise it later');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await apiKeysAPI.create(name.trim());
      setSecret(res.data.key);
    } catch (err) {
      const text = apiError(err, 'Could not create the key');
      setError(text);
      onError(text);
    } finally {
      setSaving(false);
    }
  };

  if (secret) {
    return (
      <Modal
        open
        onClose={onCreated}
        title="Copy your API key"
        footer={<Button onClick={onCreated}>Done</Button>}
      >
        <div className="space-y-4">
          <Alert tone="error">
            <span className="flex items-start gap-2">
              <ShieldAlert size={15} className="mt-0.5 shrink-0" />
              This is the only time the key is shown. It is stored hashed, so it cannot be
              retrieved later — copy it now and keep it somewhere safe.
            </span>
          </Alert>

          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-surface-2 p-3">
            <code className="min-w-0 flex-1 break-all text-[12.5px] text-ink">{secret}</code>
            <CopyButton value={secret} label="Copy key" />
          </div>

          <p className="text-[13px] text-ink-muted">
            Send it as the <code className="text-ink">X-API-Key</code> header on every request.
            Anyone holding it can read every report your company has generated, so treat it like a
            password and revoke it if it leaks.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Create API key"
      description="Name it after the system that will use it, so you know what a revoke would break."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={submit}>
            Create key
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Key name" required>
          <input
            className="input"
            autoFocus
            placeholder="e.g. Salesforce sync"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}

function RevokeKeyModal({
  apiKey,
  onClose,
  onRevoked,
  onError,
}: {
  apiKey: ApiKeyRow;
  onClose: () => void;
  onRevoked: () => void;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await apiKeysAPI.revoke(apiKey._id);
      onRevoked();
    } catch (err) {
      onError(apiError(err, 'Could not revoke the key'));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Revoke ${apiKey.name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={saving} onClick={submit}>
            Revoke key
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        Every request using <code className="text-ink">{apiKey.prefix}…{apiKey.last4}</code> starts
        failing immediately. This cannot be undone — issue a new key if you need to restore access.
      </p>
    </Modal>
  );
}
