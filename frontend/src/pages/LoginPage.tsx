import React, { useCallback, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Loader2,
  Mail,
  Phone,
  Sparkles,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { authAPI, apiError } from '../services/api';
import AuthShell from '../components/AuthShell';
import { Alert, Button, Field } from '../components/ui';

/**
 * The only public entry point into the product. There is no self-serve signup:
 * the address decides everything, and it is checked when the user submits it
 * rather than after a password attempt - nobody should type a password only to
 * be told they have no account.
 *
 *   account exists                 -> ask for the password
 *   company subscribes, no account -> "ask your admin" (stage: 'contact-admin')
 *   company unknown                -> collect a phone number, book a demo
 *
 * The lookup only ever runs from Continue: the address is the user's to finish,
 * and a screen that changes under them mid-typo is worse than one extra click.
 */
type Stage = 'email' | 'password' | 'contact-admin' | 'demo' | 'demo-sent';

// Requires a dot and a plausible TLD so an obviously incomplete address is
// rejected here instead of spending a request on it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const DEMO_PANEL = {
  heading: 'See what SalesMotion writes about the accounts you are chasing.',
  points: [
    'A 30-minute walkthrough on your own target accounts, not a canned demo deck.',
    'We set your company profile up with you so the first report is already on-message.',
    'Seats for your whole team once you are in - no per-person setup.',
  ],
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { setSession, token, user } = useAuthStore();

  const [stage, setStage] = useState<Stage>('email');
  const [form, setForm] = useState({ email: '', password: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  // Filled in by the lookup so the follow-up screens can name the company /
  // domain instead of talking in the abstract.
  const [companyName, setCompanyName] = useState('');
  const [domain, setDomain] = useState('');

  // Repeat clicks race each other: only the newest lookup may change the stage,
  // or a slow reply for the previous address would overwrite the right answer.
  const checkSeq = useRef(0);

  const runCheck = useCallback(async (email: string) => {
    const seq = ++checkSeq.current;
    setChecking(true);
    setError('');

    try {
      const { data } = await authAPI.checkEmail(email);
      if (seq !== checkSeq.current) return;

      setDomain(data.domain || email.split('@')[1] || '');
      setCompanyName(data.organizationName || '');

      if (data.status === 'ready') setStage('password');
      else if (data.status === 'no_account') setStage('contact-admin');
      else setStage('demo');
    } catch (err) {
      if (seq !== checkSeq.current) return;
      setError(apiError(err, 'Could not check that email'));
    } finally {
      if (seq === checkSeq.current) setChecking(false);
    }
  }, []);

  // Already signed in - don't show the login form again
  if (token && user) return <Navigate to="/" replace />;

  const backToEmail = () => {
    setStage('email');
    setError('');
    setChecking(false);
    checkSeq.current++; // a reply still in flight must not move the stage again
    setForm({ ...form, password: '' });
  };

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const email = form.email.trim();
    if (!EMAIL_RE.test(email)) {
      setError('Enter a valid work email address');
      return;
    }
    runCheck(email);
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await authAPI.login(form.email.trim(), form.password);
      setSession(res.data);
      navigate('/');
    } catch (err: any) {
      // The account can disappear between the check and the submit, so the
      // server's verdict still wins over what the lookup told us.
      const data = err?.response?.data;

      if (data?.code === 'ACCOUNT_NOT_PROVISIONED') {
        setCompanyName(data.organizationName || 'Your company');
        setDomain(data.domain || '');
        setStage('contact-admin');
      } else if (data?.code === 'COMPANY_NOT_REGISTERED') {
        setDomain(data.domain || form.email.split('@')[1] || '');
        setStage('demo');
      } else {
        setError(apiError(err, 'Sign in failed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const submitDemo = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await authAPI.requestDemo({ email: form.email.trim(), phone: form.phone });
      setStage('demo-sent');
    } catch (err) {
      setError(apiError(err, 'Could not send your request'));
    } finally {
      setLoading(false);
    }
  };

  // The address, locked, on every screen that follows the lookup. Kept as a
  // real input with autoComplete="username" so password managers still fill the
  // pair on the password stage.
  const lockedEmail = (
    <div className="flex items-center gap-2">
      <input
        type="email"
        autoComplete="username"
        className="input cursor-not-allowed bg-slate-50 text-ink-muted"
        value={form.email}
        readOnly
      />
      <Button type="button" variant="secondary" onClick={backToEmail} className="h-[42px] shrink-0">
        Change
      </Button>
    </div>
  );

  // --- Password -------------------------------------------------------------
  if (stage === 'password') {
    return (
      <AuthShell
        title="Welcome back"
        subtitle={companyName ? `Signing in to ${companyName}.` : 'Enter your password to continue.'}
      >
        <form onSubmit={submitPassword} className="animate-fade-in space-y-4">
          {error && <Alert tone="error">{error}</Alert>}

          <Field label="Work email" required>
            {lockedEmail}
          </Field>

          <Field label="Password" required>
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              className="input"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </Field>

          <Button type="submit" size="lg" loading={loading} className="w-full">
            Sign in
          </Button>
        </form>
      </AuthShell>
    );
  }

  // --- Company already subscribes, this person has no seat -------------------
  if (stage === 'contact-admin') {
    return (
      <AuthShell
        title="Your company is already with us"
        subtitle="You just need a seat before you can sign in."
      >
        <div className="animate-fade-in space-y-6">
          <div className="overflow-hidden rounded-xl border border-brand-200 bg-brand-50">
            <div className="flex items-start gap-4 px-5 py-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-raised">
                <Building2 size={20} />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-ink">{companyName || 'Your company'}</p>
                {domain && (
                  <p className="mt-0.5 text-[13px] font-medium text-brand-700">@{domain}</p>
                )}
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                  Good news — {companyName || 'your company'} already has a SalesMotion
                  subscription. There is just no account for{' '}
                  <span className="font-semibold text-ink">{form.email}</span> yet.
                </p>
              </div>
            </div>
            <div className="border-t border-brand-200 bg-surface px-5 py-4">
              <p className="text-sm leading-relaxed text-ink-soft">
                Ask your SalesMotion admin to add you — it takes them about a minute, and you can
                sign in here the moment they do.
              </p>
            </div>
          </div>

          <Button
            variant="secondary"
            size="lg"
            icon={ArrowLeft}
            className="w-full"
            onClick={backToEmail}
          >
            Try another email
          </Button>
        </div>
      </AuthShell>
    );
  }

  // --- Demo booked ----------------------------------------------------------
  if (stage === 'demo-sent') {
    return (
      <AuthShell
        title="Thanks — we'll be in touch"
        subtitle="Your demo request is with our team."
        aside={DEMO_PANEL}
      >
        <div className="animate-fade-in space-y-6">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-center">
            <span className="mx-auto flex h-14 w-14 animate-scale-in items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-4 ring-emerald-200/60">
              <CheckCircle2 size={30} />
            </span>
            <h3 className="mt-4 text-lg font-extrabold tracking-tight text-ink">
              We will get back to you shortly
            </h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
              One of our team will reach out within one business day to set up a walkthrough for{' '}
              {domain ? <span className="font-semibold text-ink">{domain}</span> : 'your team'}.
            </p>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm">
            <p className="flex items-center gap-2.5 text-ink-soft">
              <Mail size={15} className="shrink-0 text-ink-faint" />
              <span className="truncate">{form.email}</span>
            </p>
            <p className="flex items-center gap-2.5 text-ink-soft">
              <Phone size={15} className="shrink-0 text-ink-faint" />
              <span className="truncate">{form.phone}</span>
            </p>
          </div>

          <Button
            variant="secondary"
            size="lg"
            icon={ArrowLeft}
            className="w-full"
            onClick={backToEmail}
          >
            Back to sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  // --- Company not registered - collect a phone number and book the demo -----
  if (stage === 'demo') {
    return (
      <AuthShell
        title="Let's get you set up"
        subtitle={
          domain
            ? `@${domain} isn't on SalesMotion yet — leave us a number and we'll take it from here.`
            : "Your company isn't on SalesMotion yet — leave us a number and we'll take it from here."
        }
        aside={DEMO_PANEL}
      >
        <form onSubmit={submitDemo} className="animate-fade-in space-y-5">
          {error && <Alert tone="error">{error}</Alert>}

          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Sparkles size={16} />
            </span>
            <p className="text-[13px] leading-relaxed text-ink-muted">
              We'll walk you through SalesMotion on your own target accounts, then get your company
              profile set up so your team can start straight away.
            </p>
          </div>

          <Field label="Work email" required>
            {lockedEmail}
          </Field>

          <Field
            label="Phone number"
            hint="So we can reach you to schedule the walkthrough."
            required
          >
            <input
              type="tel"
              autoComplete="tel"
              autoFocus
              className="input"
              placeholder="+91 98765 43210"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              required
            />
          </Field>

          <Button type="submit" size="lg" icon={CalendarCheck} loading={loading} className="w-full">
            Book a demo
          </Button>
        </form>
      </AuthShell>
    );
  }

  // --- Email ----------------------------------------------------------------
  return (
    <AuthShell title="Sign in" subtitle="Start with the work email your company registered with.">
      <form onSubmit={submitEmail} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Work email" required>
          <div className="relative">
            <input
              type="email"
              autoComplete="username"
              autoFocus
              className="input pr-10"
              placeholder="you@company.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
            {checking && (
              <Loader2
                size={16}
                className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-ink-faint"
              />
            )}
          </div>
        </Field>

        <Button type="submit" size="lg" icon={ArrowRight} loading={checking} className="w-full">
          Continue
        </Button>

        <p className="pt-1 text-center text-[13px] leading-relaxed text-ink-muted">
          We'll check whether your company is already with us and take you to the right place.
        </p>
      </form>
    </AuthShell>
  );
}
