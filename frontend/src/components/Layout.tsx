import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BarChart3,
  Bell,
  Building2,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Mail,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useAuthStore, companyProfileIncomplete, focusTopics } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { inboxAPI } from '../services/api';
import { Logo, cx } from './ui';

interface NavGroup {
  label: string;
  /** Hidden entirely from members - see the filter where the rail is rendered. */
  managerOnly?: boolean;
  items: { path: string; label: string; icon: React.ElementType }[];
}

// Grouped so the sidebar reads as two jobs rather than one flat list: the
// accounts you work, and the intelligence that comes back about them.
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { path: '/', label: 'Overview', icon: LayoutDashboard },
      { path: '/accounts', label: 'Accounts', icon: Building2 },
      { path: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Stay informed',
    items: [
      { path: '/signals', label: 'Buying signals', icon: Bell },
      { path: '/alerts', label: 'Alert rules', icon: AlertCircle },
      { path: '/inbox', label: 'Inbox', icon: Mail },
    ],
  },
  // Owners and admins only. Filtered out of the rail below rather than
  // rendered disabled: a member has no use for a link they cannot open.
  {
    label: 'Administration',
    managerOnly: true,
    items: [{ path: '/analytics', label: 'Analytics', icon: BarChart3 }],
  },
];

/**
 * Segmented light/dark control. A two-state segment rather than a single
 * cycling icon: at a glance it shows which theme is active, not merely which
 * one you would get if you pressed it.
 */
function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const options = [
    { value: 'light' as const, icon: Sun, label: 'Light' },
    { value: 'dark' as const, icon: Moon, label: 'Dark' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="relative flex items-center gap-0.5 rounded-xl bg-slate-100 p-1 ring-1 ring-inset ring-slate-200/70"
    >
      {options.map(({ value, icon: Icon, label }) => {
        const active = theme === value;

        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setTheme(value)}
            className={cx(
              'relative flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-300 ease-swift',
              active
                ? 'bg-surface text-brand-600 shadow-card'
                : 'text-ink-faint hover:text-ink-muted'
            )}
          >
            <Icon size={14} className={active ? 'scale-110 transition-transform' : ''} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * One sidebar row. When the rail is collapsed the label survives as a hover
 * tooltip, so a narrow sidebar stays navigable rather than becoming a row of
 * unlabelled glyphs.
 */
function NavItem({
  to,
  label,
  icon: Icon,
  active,
  collapsed,
  badge,
}: {
  to: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  collapsed: boolean;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      className={cx(
        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ease-swift',
        active
          ? 'bg-white/[0.08] text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.08)]'
          : 'text-brand-100/60 hover:bg-white/[0.05] hover:text-white'
      )}
    >
      {/* Active marker. Scales in from nothing so switching pages animates. */}
      <span
        aria-hidden
        className={cx(
          'absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-gradient transition-transform duration-300 ease-swift',
          active ? 'scale-y-100' : 'scale-y-0'
        )}
      />

      <Icon
        size={18}
        className={cx(
          'shrink-0 transition-transform duration-200 ease-swift',
          active ? 'text-brand-300' : 'group-hover:scale-110'
        )}
      />

      {!collapsed && <span className="flex-1 truncate">{label}</span>}

      {badge !== undefined && badge > 0 && (
        <span
          className={cx(
            'rounded-full bg-amber-500 text-2xs font-bold text-white shadow-sm',
            collapsed
              ? 'absolute right-1 top-1 h-4 min-w-[16px] px-1 leading-4'
              : 'px-1.5 py-0.5'
          )}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}

      {/* Collapsed-rail tooltip */}
      {collapsed && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full z-50 ml-3 origin-left scale-90 whitespace-nowrap rounded-lg bg-navy-950 px-2.5 py-1.5 text-2xs font-semibold text-white opacity-0 shadow-pop ring-1 ring-white/10 transition-all duration-150 group-hover:scale-100 group-hover:opacity-100"
        >
          {label}
        </span>
      )}
    </Link>
  );
}

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
  const { high: priorityTopics, all: allTopics } = focusTopics(organization);
  // Only an owner or admin can fill the company profile in, so a member is told
  // who to ask rather than sent to a form they cannot edit.
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const showProfileBanner =
    companyProfileIncomplete(organization) && location.pathname !== '/settings';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* ---------------- Sidebar ---------------- */}
      <aside
        className={cx(
          'no-print relative flex shrink-0 flex-col bg-navy-900 transition-[width] duration-300 ease-swift',
          collapsed ? 'w-[76px]' : 'w-[252px]'
        )}
      >
        {/* Depth for the rail: a warm blue bloom at the top, a hairline seam on
            the right, so the navy is not a flat block of colour. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(520px 300px at 20% -5%, rgb(59 130 246 / 0.22), transparent 65%), radial-gradient(420px 260px at 110% 105%, rgb(99 102 241 / 0.16), transparent 60%)',
          }}
        />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/10" />

        <div className="relative flex h-16 items-center justify-between px-4">
          {!collapsed && <Logo light />}
          <button
            onClick={toggleSidebar}
            className={cx(
              'rounded-lg p-1.5 text-brand-200/60 transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-95',
              collapsed && 'mx-auto'
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="relative flex-1 space-y-5 overflow-y-auto px-3 py-3 scrollbar-none">
          {NAV_GROUPS.filter((group) => !group.managerOnly || isAdmin).map((group) => (
            <div key={group.label} className="space-y-1">
              {!collapsed && (
                <p className="eyebrow px-3 pb-1.5 text-brand-200/40">{group.label}</p>
              )}
              {group.items.map(({ path, label, icon }) => (
                <NavItem
                  key={path}
                  to={path}
                  label={label}
                  icon={icon}
                  active={isActive(path)}
                  collapsed={collapsed}
                  badge={path === '/inbox' ? unread : undefined}
                />
              ))}
            </div>
          ))}
        </nav>

        {/* The company's monitored topics - what every report is written around.
            High-priority ones lead, because those are the ones that steer it. */}
        {!collapsed && (
          <div className="relative mx-3 mb-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] p-3.5 backdrop-blur-sm">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-brand-500/25 blur-2xl"
            />
            <div className="relative mb-2.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.13em] text-brand-300">
              <Sparkles size={12} /> What we look for
            </div>
            {allTopics.length ? (
              <div className="relative flex flex-wrap gap-1">
                {allTopics.slice(0, 4).map((topic) => {
                  const priority = priorityTopics.includes(topic);
                  return (
                    <span
                      key={topic}
                      title={priority ? 'Top priority' : undefined}
                      className={cx(
                        'rounded-md px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset transition-transform duration-200 hover:scale-105',
                        priority
                          ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/30'
                          : 'bg-brand-500/15 text-brand-100 ring-brand-400/20'
                      )}
                    >
                      {topic}
                    </span>
                  );
                })}
              </div>
            ) : isAdmin ? (
              <Link
                to="/settings"
                className="relative text-2xs font-medium text-amber-300 hover:underline"
              >
                Not set yet — tell us what to watch for
              </Link>
            ) : (
              <p className="relative text-2xs font-medium text-amber-300">
                Not set yet — ask your admin what to watch for
              </p>
            )}
          </div>
        )}

        <div className="relative border-t border-white/10 p-3">
          <NavItem
            to="/settings"
            label="Settings"
            icon={Settings}
            active={isActive('/settings')}
            collapsed={collapsed}
          />
        </div>
      </aside>

      {/* ---------------- Main ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print glass sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200/80 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-200">
              <Building2 size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight text-ink">
                {organization?.name || user?.company}
              </p>
              <p className="truncate text-2xs text-ink-faint">
                {organization?.industry || 'Your sales workspace'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <ThemeToggle />

            <span className="mx-1.5 h-5 w-px bg-slate-200" aria-hidden="true" />

            <Link
              to="/inbox"
              className="relative rounded-xl p-2 text-ink-muted transition-all duration-200 hover:bg-slate-100 hover:text-ink active:scale-95"
              title="Inbox"
              aria-label={unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'}
            >
              <Mail size={18} />
              {unread > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-amber-400" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500 ring-2 ring-surface" />
                </span>
              )}
            </Link>

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={cx(
                  'flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-2 transition-all duration-200',
                  menuOpen ? 'bg-slate-100' : 'hover:bg-slate-100'
                )}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white shadow-brand">
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
                <ChevronDown
                  size={14}
                  className={cx(
                    'text-ink-faint transition-transform duration-200',
                    menuOpen && 'rotate-180'
                  )}
                />
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-40 mt-2 w-64 animate-scale-in rounded-2xl border border-slate-200 bg-surface p-1.5 shadow-pop"
                >
                  <div className="flex items-center gap-3 border-b border-slate-100 px-3 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">
                      {initials || '?'}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {user?.firstName} {user?.lastName}
                      </p>
                      <p className="truncate text-xs text-ink-muted">{user?.email}</p>
                    </div>
                  </div>
                  <Link
                    to="/settings"
                    role="menuitem"
                    className="mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft transition hover:bg-slate-50 hover:text-ink"
                  >
                    <Settings size={15} /> Settings
                  </Link>
                  <button
                    role="menuitem"
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
                  >
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="page-wash min-w-0 flex-1 overflow-y-auto">
          {showProfileBanner && (
            <div className="no-print border-b border-amber-200 bg-amber-50 px-6 py-3">
              <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <AlertCircle size={16} className="shrink-0 text-amber-600" />
                <span className="font-semibold text-amber-900">Tell us about your business</span>
                <span className="text-amber-800">
                  {isAdmin
                    ? 'Add what you sell and the topics you care about, so every report knows what to look for.'
                    : 'Ask an owner or admin to add what you sell and the topics you care about — reports need them.'}
                </span>
                {isAdmin && (
                  <Link
                    to="/settings"
                    className="font-semibold text-amber-900 underline underline-offset-2 transition hover:text-amber-950"
                  >
                    Finish setup
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Keyed on the path so every navigation replays the entrance */}
          <div
            key={location.pathname}
            className="mx-auto max-w-[1400px] animate-fade-in px-6 py-8"
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
