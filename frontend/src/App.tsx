import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from './store/authStore';
import { authAPI } from './services/api';

// Pages
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import OrgRegisterPage from './pages/OrgRegisterPage';
import DashboardPage from './pages/DashboardPage';
import SignalsPage from './pages/SignalsPage';
import AccountsPage from './pages/AccountsPage';
import AlertsPage from './pages/AlertsPage';
import InboxPage from './pages/InboxPage';
import ReportsPage from './pages/ReportsPage';
import ReportDetailPage from './pages/ReportDetailPage';
import SettingsPage from './pages/SettingsPage';
import AnalyticsPage from './pages/AnalyticsPage';

import Layout from './components/Layout';
import { Logo } from './components/ui';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, user, isBootstrapping } = useAuthStore();

  // Wait for the stored token to be validated before deciding. Redirecting
  // while this is still in flight logged the user out on every page refresh.
  if (isBootstrapping) {
    return (
      <div className="page-wash flex h-full flex-col items-center justify-center gap-5">
        <div className="animate-fade-in-up">
          <Logo />
        </div>
        <div
          className="flex animate-fade-in-up items-center gap-2.5 text-sm font-medium text-ink-muted"
          style={{ animationDelay: '120ms' }}
        >
          <Loader2 size={15} className="animate-spin text-brand-500" />
          Getting your workspace ready…
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  return <Layout>{children}</Layout>;
}

/**
 * A page only an owner or admin may open.
 *
 * The sidebar already hides the link, but hiding a link is presentation, not
 * access control - somebody who types the URL, or returns to a bookmark after
 * being demoted, has to land somewhere else. The API enforces the same rule
 * independently; this only decides what the browser renders.
 */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isBootstrapping } = useAuthStore();

  // Never redirect on a role that has not been loaded yet - that would bounce
  // an admin off their own page on every refresh.
  if (isBootstrapping) return <ProtectedRoute>{children}</ProtectedRoute>;

  if (user && user.role !== 'owner' && user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <ProtectedRoute>{children}</ProtectedRoute>;
}

function App() {
  const { token, setSession, setToken, setUser, setError, setBootstrapping } = useAuthStore();

  useEffect(() => {
    if (!token) {
      setBootstrapping(false);
      return;
    }

    let cancelled = false;
    setBootstrapping(true);

    authAPI
      .getMe()
      .then((res) => {
        if (cancelled) return;
        // /me returns { user, organization } so the tenant is always in hand
        setSession({ user: res.data.user, organization: res.data.organization });
      })
      .catch(() => {
        if (cancelled) return;
        setError('Session expired');
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setBootstrapping(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const protect = (element: React.ReactNode) => <ProtectedRoute>{element}</ProtectedRoute>;

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/register-company" element={<OrgRegisterPage />} />

        <Route path="/" element={protect(<DashboardPage />)} />
        <Route path="/accounts" element={protect(<AccountsPage />)} />
        <Route path="/reports" element={protect(<ReportsPage />)} />
        <Route path="/reports/:id" element={protect(<ReportDetailPage />)} />
        <Route path="/signals" element={protect(<SignalsPage />)} />
        <Route path="/alerts" element={protect(<AlertsPage />)} />
        <Route path="/inbox" element={protect(<InboxPage />)} />
        <Route path="/settings" element={protect(<SettingsPage />)} />
        <Route path="/analytics" element={<AdminRoute><AnalyticsPage /></AdminRoute>} />

        {/* Unknown paths fall back to the dashboard */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
