import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { apiError, authAPI } from '../services/api';
import AuthShell from '../components/AuthShell';
import { Alert, Button, Field, TagInput, cx } from '../components/ui';
import {
  DEPARTMENT_SUGGESTIONS,
  KEYWORD_SUGGESTIONS,
  ROLE_SUGGESTIONS,
  VERTICALS,
  capabilitySuggestionsFor,
} from '../lib/taxonomy';

interface OrgLookup {
  registered: boolean;
  domain: string;
  organization?: {
    _id: string;
    name: string;
    industry?: string;
    capabilities?: string[];
    targetIndustries?: string[];
    targetDepartments?: string[];
  };
}

export default function SignupPage() {
  const navigate = useNavigate();
  const { setSession, token, user } = useAuthStore();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [lookup, setLookup] = useState<OrgLookup | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    jobTitle: '',
    vertical: '',
    verticalCapabilities: [] as string[],
    keywords: [] as string[],
    targetDepartments: [] as string[],
    targetRoles: [] as string[],
    region: '',
  });

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const domain = useMemo(() => form.email.split('@')[1]?.trim().toLowerCase() || '', [form.email]);

  // Resolve the tenant as soon as the address looks complete, so the user finds
  // out their company is not registered before filling in the rest of the form.
  useEffect(() => {
    if (!domain || !domain.includes('.')) {
      setLookup(null);
      return;
    }

    let cancelled = false;
    setLookingUp(true);

    const timer = setTimeout(() => {
      authAPI
        .lookupDomain(form.email)
        .then((res) => {
          if (!cancelled) setLookup(res.data);
        })
        .catch((err) => {
          if (!cancelled) setLookup(err.response?.data || { registered: false, domain });
        })
        .finally(() => {
          if (!cancelled) setLookingUp(false);
        });
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [domain, form.email]);

  if (token && user) return <Navigate to="/" replace />;

  const step1Valid =
    form.firstName.trim() &&
    form.lastName.trim() &&
    /.+@.+\..+/.test(form.email) &&
    form.password.length >= 8 &&
    form.password === form.confirmPassword &&
    lookup?.registered;

  const step2Valid =
    form.vertical.trim() && form.verticalCapabilities.length > 0 && form.keywords.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!step2Valid) return;

    setLoading(true);
    setError('');

    try {
      const { confirmPassword, ...payload } = form;
      const res = await authAPI.register(payload);
      setSession(res.data);
      navigate('/');
    } catch (err) {
      setError(apiError(err, 'Could not create your account'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      wide
      title="Create your account"
      subtitle="Two steps. The second one decides what your reports focus on."
      aside={{
        heading: 'Your reports, your pitch.',
        points: [
          'Pick the vertical you sell into and the capabilities you take to market.',
          'Add the solutions you are pitching — GenAI, Copilot, whatever you lead with.',
          'Every account you add is then read through exactly that lens.',
        ],
      }}
    >
      {/* Stepper */}
      <ol className="mb-8 flex items-center gap-3">
        {['Your account', 'Your focus'].map((label, i) => {
          const id = i + 1;
          const active = step === id;
          const done = step > id;
          return (
            <React.Fragment key={label}>
              <li className="flex items-center gap-2">
                <span
                  className={cx(
                    'flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold',
                    done && 'bg-emerald-500 text-white',
                    active && 'bg-brand-600 text-white',
                    !done && !active && 'bg-slate-100 text-ink-faint'
                  )}
                >
                  {id}
                </span>
                <span className={cx('text-[13px] font-semibold', active ? 'text-ink' : 'text-ink-faint')}>
                  {label}
                </span>
              </li>
              {i === 0 && <li className="h-px flex-1 bg-slate-200" />}
            </React.Fragment>
          );
        })}
      </ol>

      <form onSubmit={submit} className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        {/* ---------------- Step 1 ---------------- */}
        {step === 1 && (
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

            <Field label="Work email" required>
              <input
                type="email"
                className="input"
                placeholder="you@company.com"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </Field>

            {/* Tenant resolution feedback */}
            {domain.includes('.') && (
              <div className="-mt-1">
                {lookingUp ? (
                  <p className="flex items-center gap-2 text-[13px] text-ink-muted">
                    <Loader2 size={14} className="animate-spin" /> Checking @{domain}…
                  </p>
                ) : lookup?.registered ? (
                  <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" />
                    <div className="min-w-0 text-[13px]">
                      <p className="font-semibold text-emerald-900">
                        Joining {lookup.organization?.name}
                      </p>
                      {lookup.organization?.capabilities?.length ? (
                        <p className="mt-0.5 text-emerald-800/80">
                          Company capabilities:{' '}
                          {lookup.organization.capabilities.slice(0, 4).join(', ')}
                          {lookup.organization.capabilities.length > 4 ? '…' : ''}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <Building2 size={17} className="mt-0.5 shrink-0 text-amber-600" />
                    <div className="min-w-0 text-[13px] text-amber-900">
                      <p className="font-semibold">No subscription found for @{domain}</p>
                      <p className="mt-0.5 text-amber-800/80">
                        Ask your admin to register, or{' '}
                        <Link
                          to="/register-company"
                          className="font-semibold underline underline-offset-2"
                        >
                          set up your company
                        </Link>{' '}
                        yourself.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Field label="Job title">
              <input
                className="input"
                placeholder="Client Partner, BFSI"
                value={form.jobTitle}
                onChange={(e) => set({ jobTitle: e.target.value })}
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

        {/* ---------------- Step 2 ---------------- */}
        {step === 2 && (
          <div className="animate-fade-in space-y-5">
            <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-[13px] leading-relaxed text-brand-800">
              These three answers decide what every report says. Add an account later and we will
              tell you where <em>that</em> company needs <em>these</em> things.
            </div>

            <Field
              label="Which vertical do you sell into?"
              required
              hint="The industry of the prospects you chase, not your own company's."
            >
              <input
                className="input"
                list="verticals"
                placeholder="Banking & Financial Services"
                value={form.vertical}
                onChange={(e) => set({ vertical: e.target.value })}
                autoFocus
              />
              <datalist id="verticals">
                {VERTICALS.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Field>

            <Field
              label="What do you look for in a prospect?"
              required
              hint="The capabilities you sell into that vertical — the problems you want to find."
            >
              <TagInput
                value={form.verticalCapabilities}
                onChange={(verticalCapabilities) => set({ verticalCapabilities })}
                placeholder="e.g. KYC/AML automation"
                suggestions={capabilitySuggestionsFor(form.vertical)}
              />
            </Field>

            <Field
              label="What are you pitching?"
              required
              hint="Your headline solutions. Reports are written to show where the prospect needs exactly these."
            >
              <TagInput
                value={form.keywords}
                onChange={(keywords) => set({ keywords })}
                placeholder="e.g. GenAI solutions, Copilot solutions"
                suggestions={KEYWORD_SUGGESTIONS}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Departments you target">
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

            <Field label="Region you cover">
              <input
                className="input"
                placeholder="EMEA"
                value={form.region}
                onChange={(e) => set({ region: e.target.value })}
              />
            </Field>
          </div>
        )}

        {/* ---------------- Nav ---------------- */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
          {step > 1 ? (
            <Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => setStep(1)}>
              Back
            </Button>
          ) : (
            <Link to="/login" className="text-sm font-medium text-ink-muted hover:text-ink">
              Already have an account?
            </Link>
          )}

          {step === 1 ? (
            <Button type="button" onClick={() => setStep(2)} disabled={!step1Valid}>
              Continue <ArrowRight size={16} />
            </Button>
          ) : (
            <Button type="submit" loading={loading} disabled={!step2Valid}>
              Create account
            </Button>
          )}
        </div>
      </form>
    </AuthShell>
  );
}
