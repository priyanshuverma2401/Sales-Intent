import React, { useState } from 'react';
import { Building2, Code2, KeyRound, Plug, Save, User as UserIcon, Users } from 'lucide-react';
import { apiError, authAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Alert, Button, Card, Field, PageHeader, cx } from '../components/ui';
import ApiKeysPanel from '../components/ApiKeysPanel';
import CompanyProfilePanel from '../components/CompanyProfilePanel';
import IntegrationsPanel from '../components/IntegrationsPanel';
import UsersPanel from '../components/UsersPanel';

type TabId = 'profile' | 'company' | 'users' | 'integrations' | 'api';

export default function SettingsPage() {
  const { user, organization, setUser, setOrganization } = useAuthStore();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  const [tab, setTab] = useState<TabId>('profile');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  // The API tab is admin-only: a key reads every report the company has ever
  // generated, so it is not something a member should see or create.
  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'profile', label: 'Profile', icon: UserIcon },
    { id: 'company', label: 'Company profile', icon: Building2 },
    { id: 'users', label: 'Users', icon: Users },
    // Admin-only: a CRM connection exposes the whole tenant's pipeline, and an
    // API key reads every report the company has ever generated
    ...(isAdmin
      ? [
          { id: 'integrations' as TabId, label: 'Integrations', icon: Plug },
          { id: 'api' as TabId, label: 'API', icon: Code2 },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="Your account, and the company profile every report is built from."
      />

      {message && (
        <div className="mb-5">
          <Alert tone={message.tone} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        </div>
      )}

      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cx(
              'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition',
              tab === id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-muted hover:text-ink'
            )}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <ProfilePanel
          user={user}
          onSaved={(updated) => {
            setUser(updated);
            setMessage({ tone: 'success', text: 'Your details are saved.' });
          }}
          onMessage={setMessage}
        />
      )}

      {tab === 'company' && (
        <CompanyProfilePanel
          organization={organization}
          canEdit={isAdmin}
          onSaved={(updated) => {
            setOrganization(updated);
            setMessage({ tone: 'success', text: 'Company profile saved.' });
          }}
          onError={(text) => setMessage({ tone: 'error', text })}
        />
      )}

      {tab === 'users' && (
        <UsersPanel actor={user} organization={organization} onMessage={setMessage} />
      )}

      {tab === 'integrations' && isAdmin && (
        <IntegrationsPanel canEdit={isAdmin} onMessage={setMessage} />
      )}

      {tab === 'api' && isAdmin && <ApiKeysPanel canEdit={isAdmin} onMessage={setMessage} />}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Profile - who this seat belongs to. Nothing here steers a report: what every
// report focuses on comes from the Company profile tab.
// ---------------------------------------------------------------------------
function ProfilePanel({
  user,
  onSaved,
  onMessage,
}: {
  user: any;
  onSaved: (user: any) => void;
  onMessage: (message: { tone: 'success' | 'error'; text: string }) => void;
}) {
  const [form, setForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
  });
  const [saving, setSaving] = useState(false);

  const dirty =
    form.firstName !== (user?.firstName || '') || form.lastName !== (user?.lastName || '');
  const valid = Boolean(form.firstName.trim() && form.lastName.trim());

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await authAPI.updateProfile({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
      });
      onSaved(res.data.user);
    } catch (err) {
      onMessage({ tone: 'error', text: apiError(err, 'Could not save your details') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="card-pad">
        <h2 className="mb-5 text-base font-bold text-ink">Your details</h2>

        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="First name" required>
              <input
                className="input"
                value={form.firstName}
                onChange={(e) => set({ firstName: e.target.value })}
              />
            </Field>
            <Field label="Last name" required>
              <input
                className="input"
                value={form.lastName}
                onChange={(e) => set({ lastName: e.target.value })}
              />
            </Field>
          </div>

          {/* Read-only: the address decides which company this seat belongs to,
              so changing it here would silently move someone between tenants. */}
          <Field
            label="Email"
            hint="Your sign-in address. Ask an owner or admin if it needs to change."
          >
            <input className="input" value={user?.email || ''} disabled readOnly />
          </Field>
        </div>

        <div className="mt-5 flex justify-end">
          <Button icon={Save} loading={saving} disabled={!dirty || !valid} onClick={save}>
            Save changes
          </Button>
        </div>
      </Card>

      <PasswordCard onMessage={onMessage} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------
function PasswordCard({
  onMessage,
}: {
  onMessage: (message: { tone: 'success' | 'error'; text: string }) => void;
}) {
  const empty = { currentPassword: '', newPassword: '', confirmPassword: '' };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const mismatch = Boolean(form.confirmPassword) && form.newPassword !== form.confirmPassword;
  const valid =
    Boolean(form.currentPassword) && form.newPassword.length >= 8 && !mismatch && Boolean(form.confirmPassword);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;

    setSaving(true);
    try {
      await authAPI.changePassword(form.currentPassword, form.newPassword);
      setForm(empty);
      onMessage({ tone: 'success', text: 'Your password has been changed.' });
    } catch (err) {
      onMessage({ tone: 'error', text: apiError(err, 'Could not change your password') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="card-pad">
      <h2 className="mb-1 text-base font-bold text-ink">Change password</h2>
      <p className="mb-5 text-[13px] leading-relaxed text-ink-muted">
        You stay signed in on this device after changing it.
      </p>

      <form onSubmit={submit} className="space-y-5">
        <Field label="Current password" required>
          <input
            type="password"
            className="input"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(e) => set({ currentPassword: e.target.value })}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="New password" required hint="At least 8 characters.">
            <input
              type="password"
              className="input"
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(e) => set({ newPassword: e.target.value })}
            />
          </Field>
          <Field
            label="Confirm new password"
            required
            error={mismatch ? 'Passwords do not match' : undefined}
          >
            <input
              type="password"
              className="input"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(e) => set({ confirmPassword: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex justify-end">
          <Button type="submit" icon={KeyRound} loading={saving} disabled={!valid}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
