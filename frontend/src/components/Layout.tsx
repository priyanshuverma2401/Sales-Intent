import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Bell,
  Building2,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useAuthStore, needsOnboarding } from '../store/authStore';
import { inboxAPI } from '../services/api';
import { Logo, cx } from './ui';

const NAV = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/accounts', label: 'Accounts', icon: Building2 },
  { path: '/reports', label: 'Reports', icon: FileText },
  { path: '/signals', label: 'Signals', icon: Bell },
  { path: '/alerts', label: 'Alerts', icon: AlertCircle },
  { path: '/inbox', label: 'Inbox', icon: Mail },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar') === 'collapsed');
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const { user, organization, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  // Refresh the badge on navigation so it reflects newly-read messages
  useEffect(() => {
    inboxAPI
      .unreadCount()
      .then((res) => setUnread(res.data.count))
      .catch(() => setUnread(0));
    setMenuOpen(false);
  }, [location.pathname]);

  // Close the account menu on any outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const toggleSidebar = () => {
    setCollapsed((c) => {
      localStorage.setItem('sidebar', c ? 'expanded' : 'collapsed');
      return !c;
    });
  };

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase();
  const keywords = user?.profile?.keywords || [];
  const showOnboardingBanner = needsOnboarding(user) && location.pathname !== '/settings';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* ---------------- Sidebar ---------------- */}
      <aside
        className={cx(
          'no-print flex shrink-0 flex-col border-r border-navy-800 bg-navy-900 transition-[width] duration-200',
          collapsed ? 'w-[68px]' : 'w-[248px]'
        )}
      >
        <div className="flex h-16 items-center justify-between px-4">
          {!collapsed && <Logo light />}
          <button
            onClick={toggleSidebar}
            className="rounded-lg p-1.5 text-brand-200/60 transition hover:bg-navy-800 hover:text-white"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3 scrollbar-none">
          {NAV.map(({ path, label, icon: Icon }) => {
            const active = isActive(path);
            return (
              <Link
                key={path}
                to={path}
                title={collapsed ? label : undefined}
                className={cx(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                  active
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-brand-100/70 hover:bg-navy-800 hover:text-white'
                )}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{label}</span>}
                {path === '/inbox' && unread > 0 && (
                  <span
                    className={cx(
                      'rounded-full bg-amber-500 text-2xs font-bold text-white',
                      collapsed
                        ? 'absolute right-1.5 top-1.5 h-4 min-w-[16px] px-1 leading-4'
                        : 'px-1.5 py-0.5'
                    )}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Pitch lens - always visible so the rep knows what reports will focus on */}
        {!collapsed && (
          <div className="mx-3 mb-3 rounded-lg border border-navy-700 bg-navy-800/60 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-brand-300">
              <Sparkles size={12} /> Pitch focus
            </div>
            {keywords.length ? (
              <div className="flex flex-wrap gap-1">
                {keywords.slice(0, 4).map((k) => (
                  <span
                    key={k}
                    className="rounded bg-brand-500/15 px-1.5 py-0.5 text-2xs font-medium text-brand-100"
                  >
                    {k}
                  </span>
                ))}
              </div>
            ) : (
              <Link to="/settings" className="text-2xs font-medium text-amber-300 hover:underline">
                Not set — add your keywords
              </Link>
            )}
          </div>
        )}

        <div className="border-t border-navy-800 p-3">
          <Link
            to="/settings"
            title={collapsed ? 'Settings' : undefined}
            className={cx(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
              isActive('/settings')
                ? 'bg-navy-800 text-white'
                : 'text-brand-100/70 hover:bg-navy-800 hover:text-white'
            )}
          >
            <Settings size={18} className="shrink-0" />
            {!collapsed && <span>Settings</span>}
          </Link>
        </div>
      </aside>

      {/* ---------------- Main ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Building2 size={16} className="shrink-0 text-ink-faint" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">
                {organization?.name || user?.company}
              </p>
              <p className="truncate text-2xs text-ink-faint">
                {user?.profile?.vertical || 'Sales intelligence workspace'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Link
              to="/inbox"
              className="relative rounded-lg p-2 text-ink-muted transition hover:bg-slate-100 hover:text-ink"
              title="Inbox"
            >
              <Mail size={18} />
              {unread > 0 && (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </Link>

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 transition hover:bg-slate-100"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                  {initials || '?'}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-[13px] font-semibold leading-tight text-ink">
                    {user?.firstName} {user?.lastName}
                  </span>
                  <span className="block text-2xs capitalize leading-tight text-ink-faint">
                    {user?.role}
                  </span>
                </span>
                <ChevronDown size={14} className="text-ink-faint" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-40 mt-2 w-64 animate-scale-in rounded-xl border border-slate-200 bg-white p-1.5 shadow-pop">
                  <div className="border-b border-slate-100 px-3 py-2.5">
                    <p className="truncate text-sm font-semibold text-ink">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="truncate text-xs text-ink-muted">{user?.email}</p>
                  </div>
                  <Link
                    to="/settings"
                    className="mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-soft transition hover:bg-slate-50"
                  >
                    <Settings size={15} /> Settings & focus
                  </Link>
                  <button
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 transition hover:bg-red-50"
                  >
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {showOnboardingBanner && (
            <div className="no-print border-b border-amber-200 bg-amber-50 px-6 py-3">
              <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <AlertCircle size={16} className="shrink-0 text-amber-600" />
                <span className="font-semibold text-amber-900">Finish your setup</span>
                <span className="text-amber-800">
                  Add your vertical, capabilities and pitch keywords so reports know what to look for.
                </span>
                <Link
                  to="/settings"
                  className="font-semibold text-amber-900 underline underline-offset-2"
                >
                  Complete now
                </Link>
              </div>
            </div>
          )}

          <div className="mx-auto max-w-[1400px] px-6 py-7">{children}</div>
        </main>
      </div>
    </div>
  );
}
