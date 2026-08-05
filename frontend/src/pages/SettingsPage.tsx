import React, { useState } from 'react';
import { Building2, Plug, Save, Sparkles, Users } from 'lucide-react';
import { apiError, authAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Alert, Button, Card, Field, PageHeader, TagInput, cx } from '../components/ui';
import CompanyProfilePanel from '../components/CompanyProfilePanel';
import IntegrationsPanel from '../components/IntegrationsPanel';
import UsersPanel from '../components/UsersPanel';
import {
  DEPARTMENT_SUGGESTIONS,
  KEYWORD_SUGGESTIONS,
  ROLE_SUGGESTIONS,
  VERTICALS,
  capabilitySuggestionsFor,
} from '../lib/taxonomy';

type TabId = 'focus' | 'company' | 'users' | 'integrations';

export default function SettingsPage() {
  const { user, organization, setUser, setOrganization } = useAuthStore();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  const [tab, setTab] = useState<TabId>('focus');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'focus', label: 'Your focus', icon: Sparkles },
    { id: 'company', label: 'Company profile', icon: Building2 },
    { id: 'users', label: 'Users', icon: Users },
    // Admin-only: a CRM connection exposes the whole tenant's pipeline
    ...(isAdmin ? [{ id: 'integrations' as TabId, label: 'Integrations', icon: Plug }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="What you sell and what you pitch — the two inputs every report is built from."
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

      {tab === 'focus' && (
        <FocusPanel
          user={user}
          onSaved={(updated) => {
            setUser(updated);
            setMessage({ tone: 'success', text: 'Your focus is saved. New reports will use it.' });
          }}
          onError={(text) => setMessage({ tone: 'error', text })}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// My focus - the three answers that steer report generation
// ---------------------------------------------------------------------------
function FocusPanel({
  user,
  onSaved,
  onError,
}: {
  user: any;
  onSaved: (user: any) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    jobTitle: user?.jobTitle || '',
    vertical: user?.profile?.vertical || '',
    verticalCapabilities: user?.profile?.verticalCapabilities || [],
    keywords: user?.profile?.keywords || [],
    targetDepartments: user?.profile?.targetDepartments || [],
    targetRoles: user?.profile?.targetRoles || [],
    region: user?.profile?.region || '',
  });
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await authAPI.updateProfile(form as any);
      onSaved(res.data.user);
    } catch (err) {
      onError(apiError(err, 'Could not save your focus'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="card-pad">
        <h2 className="mb-1 text-base font-bold text-ink">Report targeting</h2>
        <p className="mb-5 text-[13px] leading-relaxed text-ink-muted">
          These three fields are the primary lens. A report for “GenAI solutions” argues where the
          prospect needs GenAI — not a generic company profile.
        </p>

        <div className="space-y-5">
          <Field
            label="Vertical you sell into"
            required
            hint="The industry of your prospects, not your own company's."
          >
            <input
              className="input"
              list="settings-verticals"
              placeholder="Banking & Financial Services"
              value={form.vertical}
              onChange={(e) => set({ vertical: e.target.value })}
            />
            <datalist id="settings-verticals">
              {VERTICALS.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </Field>

          <Field
            label="What you look for in a prospect"
            required
            hint="The capabilities you sell into that vertical — the problems worth finding."
          >
            <TagInput
              value={form.verticalCapabilities}
              onChange={(verticalCapabilities) => set({ verticalCapabilities })}
              placeholder="e.g. KYC/AML automation"
              suggestions={capabilitySuggestionsFor(form.vertical)}
            />
          </Field>

          <Field
            label="What you are pitching"
            required
            hint="Your headline solutions. Every insight is connected back to these."
          >
            <TagInput
              value={form.keywords}
              onChange={(keywords) => set({ keywords })}
              placeholder="e.g. GenAI solutions, Copilot solutions"
              suggestions={KEYWORD_SUGGESTIONS}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Departments you target" hint="Used to score hiring signals.">
              <TagInput
                value={form.targetDepartments}
                onChange={(targetDepartments) => set({ targetDepartments })}
                placeholder="e.g. Technology / IT"
                suggestions={DEPARTMENT_SUGGESTIONS}
              />
            </Field>
            <Field label="Buyer roles">
              <TagInput
                value={form.targetRoles}
                onChange={(targetRoles) => set({ targetRoles })}
                placeholder="e.g. CIO"
                suggestions={ROLE_SUGGESTIONS}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card className="card-pad">
        <h2 className="mb-5 text-base font-bold text-ink">Your details</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="First name">
            <input
              className="input"
              value={form.firstName}
              onChange={(e) => set({ firstName: e.target.value })}
            />
          </Field>
          <Field label="Last name">
            <input
              className="input"
              value={form.lastName}
              onChange={(e) => set({ lastName: e.target.value })}
            />
          </Field>
          <Field label="Job title">
            <input
              className="input"
              value={form.jobTitle}
              onChange={(e) => set({ jobTitle: e.target.value })}
            />
          </Field>
          <Field label="Region">
            <input
              className="input"
              placeholder="EMEA"
              value={form.region}
              onChange={(e) => set({ region: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button icon={Save} loading={saving} onClick={save}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
