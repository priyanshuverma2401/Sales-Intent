import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Building2, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { apiError, authAPI } from '../services/api';
import AuthShell from '../components/AuthShell';
import { Alert, Button, Field } from '../components/ui';

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

/**
 * One step. A seat needs nothing beyond who the person is: every report is
 * written from the company profile their admin maintains, so there is no
 * personal targeting left to ask for.
 */
export default function SignupPage() {
  const navigate = useNavigate();
  const { setSession, token, user } = useAuthStore();

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

  const valid =
    form.firstName.trim() &&
    form.lastName.trim() &&
    /.+@.+\..+/.test(form.email) &&
    form.password.length >= 8 &&
    form.password === form.confirmPassword &&
    lookup?.registered;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;

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
      subtitle="One step. Your reports are already targeted by your company profile."
      aside={{
        heading: 'Your company’s pitch, on every account.',
        points: [
          'Reports are written from your company profile — what you sell and the topics you monitor.',
          'Topics your admin marks high priority lead every report.',
          'Add an account and we will tell you where that company needs exactly those things.',
        ],
      }}
    >
      <form onSubmit={submit} className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

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

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
          <Link to="/login" className="text-sm font-medium text-ink-muted hover:text-ink">
            Already have an account?
          </Link>
          <Button type="submit" loading={loading} disabled={!valid}>
            Create account
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
