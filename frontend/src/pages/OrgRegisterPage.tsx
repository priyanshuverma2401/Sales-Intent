import React, { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, Check, Sparkles, User } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { apiError, authAPI } from '../services/api';
import AuthShell from '../components/AuthShell';
import { Alert, Button, Field, TagInput, cx } from '../components/ui';
import {
  COMPANY_CAPABILITY_SUGGESTIONS,
  DEPARTMENT_SUGGESTIONS,
  ROLE_SUGGESTIONS,
  VERTICALS,
} from '../lib/taxonomy';

// Step 2 is the point of the whole screen: the capabilities captured here are
// the seller half of every report this company's employees will ever generate.
const STEPS = [
  { id: 1, label: 'Company', icon: Building2 },
  { id: 2, label: 'Capabilities', icon: Sparkles },
  { id: 3, label: 'Admin account', icon: User },
];

export default function OrgRegisterPage() {
  const navigate = useNavigate();
  const { setSession, token, user } = useAuthStore();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    companyName: '',
    website: '',
    industry: '',
    headquarters: '',
    description: '',
    capabilities: [] as string[],
    capabilityNotes: '',
    valuePropositions: [] as string[],
    proofPoints: [] as string[],
    targetIndustries: [] as string[],
    targetDepartments: [] as string[],
    targetRoles: [] as string[],
    firstName: '',
    lastName: '',
    jobTitle: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const emailDomain = useMemo(() => form.email.split('@')[1]?.trim().toLowerCase() || '', [form.email]);

  if (token && user) return <Navigate to="/" replace />;

  const stepValid = (id: number) => {
    if (id === 1) return form.companyName.trim().length > 1;
    if (id === 2) return form.capabilities.length > 0;
    if (id === 3) {
      return (
        form.firstName.trim() &&
        form.lastName.trim() &&
        /.+@.+\..+/.test(form.email) &&
        form.password.length >= 8 &&
        form.password === form.confirmPassword
      );
    }
    return false;
  };

  const next = () => {
    if (!stepValid(step)) return;
    setError('');
    setStep((s) => Math.min(3, s + 1));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stepValid(3)) return;

    setLoading(true);
    setError('');

    try {
      const { confirmPassword, ...payload } = form;
      const res = await authAPI.registerOrganization(payload);
      setSession(res.data);
      navigate('/');
    } catch (err) {
      setError(apiError(err, 'Registration failed'));
      // Domain clashes are reported against the admin email, so send the user back
      if (String(apiError(err)).includes('already registered')) setStep(3);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      wide
      title="Register your company"
      subtitle="Set up the subscription once. Your team then creates their own accounts with your work email domain."
      aside={{
        heading: 'Tell us what you sell. We will tell your team who needs it.',
        points: [
          'Your capabilities become the seller half of every report your reps generate.',
          'Reps add their own vertical focus and the solutions they pitch.',
          'Anyone with your email domain can then claim a seat.',
        ],
      }}
    >
      {/* Stepper */}
      <ol className="mb-8 flex items-center gap-2">
        {STEPS.map((s, i) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <React.Fragment key={s.id}>
              <li className="flex items-center gap-2">
                <span
                  className={cx(
                    'flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold transition',
                    done && 'bg-emerald-500 text-white',
                    active && 'bg-brand-600 text-white',
                    !done && !active && 'bg-slate-100 text-ink-faint'
                  )}
                >
                  {done ? <Check size={15} /> : s.id}
                </span>
                <span
                  className={cx(
                    'hidden text-[13px] font-semibold sm:block',
                    active ? 'text-ink' : 'text-ink-faint'
                  )}
                >
                  {s.label}
                </span>
              </li>
              {i < STEPS.length - 1 && <li className="h-px flex-1 bg-slate-200" />}
            </React.Fragment>
          );
        })}
      </ol>

      <form onSubmit={submit} className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        {/* ---------------- Step 1: company ---------------- */}
        {step === 1 && (
          <div className="animate-fade-in space-y-5">
            <Field label="Company name" required>
              <input
                className="input"
                placeholder="Acme Consulting Group"
                value={form.companyName}
                onChange={(e) => set({ companyName: e.target.value })}
                autoFocus
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Website">
                <input
                  className="input"
                  placeholder="https://acme.com"
                  value={form.website}
                  onChange={(e) => set({ website: e.target.value })}
                />
              </Field>
              <Field label="Your industry">
                <input
                  className="input"
                  list="org-industries"
                  placeholder="Professional Services"
                  value={form.industry}
                  onChange={(e) => set({ industry: e.target.value })}
                />
                <datalist id="org-industries">
                  {VERTICALS.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </Field>
            </div>

            <Field label="Headquarters">
              <input
                className="input"
                placeholder="London, United Kingdom"
                value={form.headquarters}
                onChange={(e) => set({ headquarters: e.target.value })}
              />
            </Field>

            <Field
              label="What does your company do?"
              hint="Two or three sentences. This grounds every report — the more specific, the sharper the output."
            >
              <textarea
                className="input"
                rows={4}
                placeholder="We deliver transformation-led business process management for financial services, combining intelligent automation, analytics and domain specialists…"
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
          </div>
        )}

        {/* ---------------- Step 2: capabilities ---------------- */}
        {step === 2 && (
          <div className="animate-fade-in space-y-5">
            <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-[13px] leading-relaxed text-brand-800">
              These capabilities are matched against every prospect your team adds. A report will
              argue for what you can actually deliver — nothing else.
            </div>

            <Field
              label="Capabilities you can deliver"
              required
              hint="Press Enter after each. Add the ones you would put in a proposal."
            >
              <TagInput
                value={form.capabilities}
                onChange={(capabilities) => set({ capabilities })}
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
                placeholder="EXPIRIUS CX platform, Insurance TRAC™, co-creation delivery model, 63,000 specialists across 13 countries…"
                value={form.capabilityNotes}
                onChange={(e) => set({ capabilityNotes: e.target.value })}
              />
            </Field>

            <Field label="Value propositions" hint="The outcomes you sell, not the services.">
              <TagInput
                value={form.valuePropositions}
                onChange={(valuePropositions) => set({ valuePropositions })}
                placeholder="e.g. 40% lower cost-to-serve"
              />
            </Field>

            <Field label="Proof points" hint="Results you can cite. These end up in the value story.">
              <TagInput
                value={form.proofPoints}
                onChange={(proofPoints) => set({ proofPoints })}
                placeholder="e.g. 85% straight-through processing at a UK insurer"
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Industries you target">
                <TagInput
                  value={form.targetIndustries}
                  onChange={(targetIndustries) => set({ targetIndustries })}
                  placeholder="e.g. Insurance"
                  suggestions={VERTICALS}
                />
              </Field>
              <Field label="Departments you sell to">
                <TagInput
                  value={form.targetDepartments}
                  onChange={(targetDepartments) => set({ targetDepartments })}
                  placeholder="e.g. Operations"
                  suggestions={DEPARTMENT_SUGGESTIONS}
                />
              </Field>
            </div>

            <Field label="Buyer roles" hint="Used to score whether a prospect is hiring into your buying centre.">
              <TagInput
                value={form.targetRoles}
                onChange={(targetRoles) => set({ targetRoles })}
                placeholder="e.g. CIO"
                suggestions={ROLE_SUGGESTIONS}
              />
            </Field>
          </div>
        )}

        {/* ---------------- Step 3: admin ---------------- */}
        {step === 3 && (
          <div className="animate-fade-in space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="First name" required>
                <input
                  className="input"
                  value={form.firstName}
                  onChange={(e) => set({ firstName: e.target.value })}
                  autoFocus
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

            <Field label="Job title">
              <input
                className="input"
                placeholder="Head of Sales"
                value={form.jobTitle}
                onChange={(e) => set({ jobTitle: e.target.value })}
              />
            </Field>

            <Field
              label="Work email"
              required
              hint={
                emailDomain
                  ? `Anyone with an @${emailDomain} address will be able to create their own account.`
                  : 'Must be a company address — this domain becomes your team’s sign-up key.'
              }
            >
              <input
                type="email"
                className="input"
                placeholder="you@acme.com"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Password" required hint="At least 8 characters.">
                <input
                  type="password"
                  className="input"
                  value={form.password}
                  onChange={(e) => set({ password: e.target.value })}
                />
              </Field>
              <Field
                label="Confirm password"
                required
                error={
                  form.confirmPassword && form.password !== form.confirmPassword
                    ? 'Passwords do not match'
                    : undefined
                }
              >
                <input
                  type="password"
                  className="input"
                  value={form.confirmPassword}
                  onChange={(e) => set({ confirmPassword: e.target.value })}
                />
              </Field>
            </div>
          </div>
        )}

        {/* ---------------- Nav ---------------- */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
          {step > 1 ? (
            <Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : (
            <Link to="/login" className="text-sm font-medium text-ink-muted hover:text-ink">
              Back to sign in
            </Link>
          )}

          {step < 3 ? (
            <Button type="button" onClick={next} disabled={!stepValid(step)}>
              Continue <ArrowRight size={16} />
            </Button>
          ) : (
            <Button type="submit" loading={loading} disabled={!stepValid(3)}>
              Create organisation
            </Button>
          )}
        </div>
      </form>
    </AuthShell>
  );
}
