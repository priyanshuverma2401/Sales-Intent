import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { authAPI, apiError } from '../services/api';
import AuthShell from '../components/AuthShell';
import { Alert, Button, Field } from '../components/ui';

export default function LoginPage() {
  const navigate = useNavigate();
  const { setSession, token, user } = useAuthStore();

  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Already signed in - don't show the login form again
  if (token && user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await authAPI.login(form.email, form.password);
      setSession(res.data);
      navigate('/');
    } catch (err) {
      setError(apiError(err, 'Sign in failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Use the work email your company registered with.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Work email" required>
          <input
            type="email"
            autoComplete="email"
            className="input"
            placeholder="you@company.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </Field>

        <Field label="Password" required>
          <input
            type="password"
            autoComplete="current-password"
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

      <div className="mt-8 space-y-3 border-t border-slate-200 pt-6 text-sm">
        <p className="text-ink-muted">
          Your company already subscribes?{' '}
          <Link to="/signup" className="font-semibold text-brand-600 hover:text-brand-700">
            Create your employee account
          </Link>
        </p>
        <p className="text-ink-muted">
          Registering a new company?{' '}
          <Link
            to="/register-company"
            className="font-semibold text-brand-600 hover:text-brand-700"
          >
            Set up your organisation
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
