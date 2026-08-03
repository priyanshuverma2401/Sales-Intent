import React, { useEffect, useState } from 'react';
import { Building2, Save, Sparkles, Users } from 'lucide-react';
import { apiError, authAPI, organizationsAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  Spinner,
  TagInput,
  cx,
} from '../components/ui';
import {
  COMPANY_CAPABILITY_SUGGESTIONS,
  DEPARTMENT_SUGGESTIONS,
  KEYWORD_SUGGESTIONS,
  ROLE_SUGGESTIONS,
  VERTICALS,
  capabilitySuggestionsFor,
} from '../lib/taxonomy';

type TabId = 'focus' | 'company' | 'team';

export default function SettingsPage() {
  const { user, organization, setUser, setOrganization } = useAuthStore();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  const [tab, setTab] = useState<TabId>('focus');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'focus', label: 'My focus', icon: Sparkles },
    { id: 'company', label: 'Company profile', icon: Building2 },
    { id: 'team', label: 'Team', icon: Users },
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
        <CompanyPanel
          organization={organization}
          canEdit={isAdmin}
          onSaved={(updated) => {
            setOrganization(updated);
            setMessage({ tone: 'success', text: 'Company profile saved.' });
          }}
          onError={(text) => setMessage({ tone: 'error', text })}
        />
      )}

      {tab === 'team' && <TeamPanel />}
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

// ---------------------------------------------------------------------------
// Company profile - the seller half of every report
// ---------------------------------------------------------------------------
function CompanyPanel({
  organization,
  canEdit,
  onSaved,
  onError,
}: {
  organization: any;
  canEdit: boolean;
  onSaved: (organization: any) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: organization?.name || '',
    website: organization?.website || '',
    industry: organization?.industry || '',
    headquarters: organization?.headquarters || '',
    description: organization?.description || '',
    capabilities: organization?.capabilities || [],
    capabilityNotes: organization?.capabilityNotes || '',
    valuePropositions: organization?.valuePropositions || [],
    proofPoints: organization?.proofPoints || [],
    targetIndustries: organization?.targetIndustries || [],
    targetDepartments: organization?.targetDepartments || [],
    targetRoles: organization?.targetRoles || [],
  });
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await organizationsAPI.update(form);
      onSaved(res.data);
    } catch (err) {
      onError(apiError(err, 'Could not save the company profile'));
    } finally {
      setSaving(false);
    }
  };

  if (!organization) return <Spinner />;

  return (
    <div className="space-y-5">
      {!canEdit && (
        <Alert tone="info">
          Only owners and admins can edit the company profile. You can still see what your reports
          are built from.
        </Alert>
      )}

      <Card className="card-pad">
        <h2 className="mb-1 text-base font-bold text-ink">What your company sells</h2>
        <p className="mb-5 text-[13px] leading-relaxed text-ink-muted">
          Shared by everyone on your team. Reports only argue for capabilities listed here.
        </p>

        <div className="space-y-5">
          <Field label="Capabilities" required>
            <TagInput
              value={form.capabilities}
              onChange={(capabilities) => canEdit && set({ capabilities })}
              placeholder="e.g. Intelligent automation"
              suggestions={COMPANY_CAPABILITY_SUGGESTIONS}
            />
          </Field>

          <Field
            label="Capability detail"
            hint="Named platforms, accelerators or methods your reps reference on calls."
          >
            <textarea
              className="input"
              rows={3}
              disabled={!canEdit}
              value={form.capabilityNotes}
              onChange={(e) => set({ capabilityNotes: e.target.value })}
            />
          </Field>

          <Field label="Value propositions" hint="The outcomes you sell, not the services.">
            <TagInput
              value={form.valuePropositions}
              onChange={(valuePropositions) => canEdit && set({ valuePropositions })}
              placeholder="e.g. 40% lower cost-to-serve"
            />
          </Field>

          <Field label="Proof points" hint="Results you can cite. They surface in the value story.">
            <TagInput
              value={form.proofPoints}
              onChange={(proofPoints) => canEdit && set({ proofPoints })}
              placeholder="e.g. 85% straight-through processing at a UK insurer"
            />
          </Field>
        </div>
      </Card>

      <Card className="card-pad">
        <h2 className="mb-5 text-base font-bold text-ink">Company details</h2>
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Company name">
              <input
                className="input"
                disabled={!canEdit}
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field label="Website">
              <input
                className="input"
                disabled={!canEdit}
                value={form.website}
                onChange={(e) => set({ website: e.target.value })}
              />
            </Field>
            <Field label="Industry">
              <input
                className="input"
                disabled={!canEdit}
                value={form.industry}
                onChange={(e) => set({ industry: e.target.value })}
              />
            </Field>
            <Field label="Headquarters">
              <input
                className="input"
                disabled={!canEdit}
                value={form.headquarters}
                onChange={(e) => set({ headquarters: e.target.value })}
              />
            </Field>
          </div>

          <Field label="What your company does" hint="Grounds every report. Be specific.">
            <textarea
              className="input"
              rows={4}
              disabled={!canEdit}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Industries you target">
              <TagInput
                value={form.targetIndustries}
                onChange={(targetIndustries) => canEdit && set({ targetIndustries })}
                placeholder="e.g. Insurance"
                suggestions={VERTICALS}
              />
            </Field>
            <Field label="Departments you sell to">
              <TagInput
                value={form.targetDepartments}
                onChange={(targetDepartments) => canEdit && set({ targetDepartments })}
                placeholder="e.g. Operations"
                suggestions={DEPARTMENT_SUGGESTIONS}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card className="card-pad">
        <h2 className="mb-4 text-base font-bold text-ink">Subscription</h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-2xs font-bold uppercase tracking-wider text-ink-faint">Plan</dt>
            <dd className="mt-1 text-sm font-semibold capitalize text-ink">
              {organization.subscription?.plan || 'trial'}
            </dd>
          </div>
          <div>
            <dt className="text-2xs font-bold uppercase tracking-wider text-ink-faint">Seats</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">
              {organization.seatsUsed ?? '—'} of {organization.subscription?.seats ?? '—'} used
            </dd>
          </div>
          <div>
            <dt className="text-2xs font-bold uppercase tracking-wider text-ink-faint">
              Sign-up domains
            </dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {(organization.domains || []).map((d: string) => (
                <Badge key={d} tone="brand">
                  @{d}
                </Badge>
              ))}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-[13px] text-ink-muted">
          Anyone with one of these email domains can create their own account against your
          subscription.
        </p>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button icon={Save} loading={saving} onClick={save}>
            Save company profile
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team roster
// ---------------------------------------------------------------------------
function TeamPanel() {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    organizationsAPI
      .members()
      .then((res) => setMembers(res.data))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-6 py-4">
        <h2 className="text-base font-bold text-ink">Team</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          {members.length} {members.length === 1 ? 'person' : 'people'} on this subscription.
        </p>
      </div>

      <ul className="divide-y divide-slate-100">
        {members.map((member) => (
          <li key={member._id} className="flex flex-wrap items-center gap-4 px-6 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
              {`${member.firstName?.[0] || ''}${member.lastName?.[0] || ''}`.toUpperCase()}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {member.firstName} {member.lastName}
                {member.jobTitle && (
                  <span className="ml-2 font-normal text-ink-muted">{member.jobTitle}</span>
                )}
              </p>
              <p className="truncate text-[13px] text-ink-muted">{member.email}</p>
              {member.profile?.keywords?.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {member.profile.keywords.slice(0, 4).map((k: string) => (
                    <span
                      key={k}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-2xs font-medium text-ink-muted"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <Badge tone={member.role === 'owner' ? 'brand' : 'neutral'}>{member.role}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
