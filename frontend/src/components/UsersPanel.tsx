import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Search,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { apiError, organizationsAPI } from '../services/api';
import { Alert, Badge, Button, Card, Field, Modal, Spinner, cx } from './ui';

// The admin's user list: every seat on the subscription, with the add/edit/
// remove controls an admin needs. Who may act on whom is enforced server-side;
// the same rule is mirrored here so the UI never offers a call that will 403.

type Member = {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle?: string;
  role: 'owner' | 'admin' | 'member';
  preferences?: { emailAlerts?: boolean };
  createdAt?: string;
  lastLogin?: string;
};

type SortKey = 'name' | 'email' | 'createdAt';

const ROLE_LABELS: Record<Member['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Standard',
};

/**
 * An admin runs the team but stops at their own tier: only the owner can touch
 * another admin, and the owner account is never editable from here.
 */
function canManage(actor: any, target: Member) {
  if (!actor) return false;
  if (actor.role !== 'owner' && actor.role !== 'admin') return false;
  if (String(target._id) === String(actor._id ?? actor.id)) return true;
  if (target.role === 'owner') return false;
  if (target.role === 'admin' && actor.role !== 'owner') return false;
  return true;
}

function isSelf(actor: any, target: Member) {
  return String(target._id) === String(actor?._id ?? actor?.id);
}

function fullName(member: Member) {
  return `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.email;
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || parts[0] || '',
  };
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function UsersPanel({
  actor,
  organization,
  onMessage,
}: {
  actor: any;
  organization: any;
  onMessage: (message: { tone: 'success' | 'error'; text: string }) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  });
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const isManager = actor?.role === 'owner' || actor?.role === 'admin';
  const seats = organization?.subscription?.seats;

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await organizationsAPI.members(q ? { q } : undefined);
      setMembers(res.data || []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Search runs server-side so it covers every seat, not just the loaded page
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(0);
    load(search);
  }, [search, load]);

  const sorted = useMemo(() => {
    const rows = [...members];
    rows.sort((a, b) => {
      const factor = sort.dir === 'asc' ? 1 : -1;
      if (sort.key === 'createdAt') {
        return (
          factor * (new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
        );
      }
      const left = sort.key === 'email' ? a.email : fullName(a);
      const right = sort.key === 'email' ? b.email : fullName(b);
      return factor * left.localeCompare(right, undefined, { sensitivity: 'base' });
    });
    return rows;
  }, [members, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const safePage = Math.min(page, pageCount - 1);
  const visible = sorted.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage);
  const rangeStart = sorted.length === 0 ? 0 : safePage * rowsPerPage + 1;
  const rangeEnd = Math.min(sorted.length, (safePage + 1) * rowsPerPage);

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );

  const afterChange = (text: string) => {
    onMessage({ tone: 'success', text });
    load(search);
  };

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-6 py-5">
          <h2 className="text-lg font-bold tracking-tight text-ink">Users</h2>
          <Badge tone="neutral">
            {members.length}
            {seats ? ` of ${seats}` : ''} seats used
          </Badge>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 border-b border-slate-300 px-1 focus-within:border-brand-500">
              <Search size={15} className="shrink-0 text-ink-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email"
                className="w-56 border-0 bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
            {isManager && (
              <Button icon={Plus} onClick={() => setAdding(true)}>
                Add User
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <Spinner />
        ) : sorted.length === 0 ? (
          <p className="border-t border-slate-100 px-6 py-10 text-center text-sm text-ink-muted">
            {search ? `No users match “${search}”.` : 'No users yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="border-y border-slate-100 bg-slate-50">
                <tr>
                  <SortableHeader label="Name" active={sort} sortKey="name" onSort={toggleSort} />
                  <SortableHeader label="Email" active={sort} sortKey="email" onSort={toggleSort} />
                  <SortableHeader
                    label="Created at"
                    active={sort}
                    sortKey="createdAt"
                    onSort={toggleSort}
                  />
                  <th className="w-24 px-6 py-3" />
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {visible.map((member) => {
                  const manageable = canManage(actor, member);
                  const self = isSelf(actor, member);

                  return (
                    <tr key={member._id} className="hover:bg-slate-50">
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-ink-faint">
                            <UserIcon size={17} />
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-ink">
                                {fullName(member)}
                              </span>
                              <CopyButton value={fullName(member)} label="name" />
                            </span>
                            {member.role !== 'member' && (
                              <span className="mt-0.5 flex">
                                <Badge tone={member.role === 'owner' ? 'brand' : 'neutral'}>
                                  {ROLE_LABELS[member.role]}
                                </Badge>
                              </span>
                            )}
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-3.5">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm text-ink-soft">{member.email}</span>
                          <CopyButton value={member.email} label="email" />
                        </span>
                      </td>

                      <td className="px-6 py-3.5 text-sm text-ink-soft">
                        {formatDate(member.createdAt)}
                      </td>

                      <td className="px-6 py-3.5">
                        {isManager && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              disabled={!manageable}
                              onClick={() => setEditing(member)}
                              title={manageable ? 'Edit user' : lockReason(actor, member)}
                              aria-label={`Edit ${fullName(member)}`}
                              className="rounded-lg p-1.5 text-brand-600 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              disabled={!manageable || self}
                              onClick={() => setRemoving(member)}
                              title={
                                self
                                  ? 'You cannot remove your own account'
                                  : manageable
                                    ? 'Remove user'
                                    : lockReason(actor, member)
                              }
                              aria-label={`Remove ${fullName(member)}`}
                              className="rounded-lg p-1.5 text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && sorted.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-4 border-t border-slate-100 px-6 py-3">
            <label className="flex items-center gap-2 text-[13px] text-ink-muted">
              Rows per page:
              <select
                value={rowsPerPage}
                onChange={(e) => {
                  setRowsPerPage(Number(e.target.value));
                  setPage(0);
                }}
                className="rounded-md border border-slate-300 bg-surface px-2 py-1 text-[13px] text-ink"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <span className="text-[13px] text-ink-muted">
              {rangeStart}–{rangeEnd} of {sorted.length}
            </span>

            <div className="flex items-center gap-0.5">
              <PageButton
                icon={ChevronsLeft}
                label="First page"
                disabled={safePage === 0}
                onClick={() => setPage(0)}
              />
              <PageButton
                icon={ChevronLeft}
                label="Previous page"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              />
              <PageButton
                icon={ChevronRight}
                label="Next page"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              />
              <PageButton
                icon={ChevronsRight}
                label="Last page"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(pageCount - 1)}
              />
            </div>
          </div>
        )}
      </Card>

      {adding && (
        <AddUserModal
          organization={organization}
          onClose={() => setAdding(false)}
          onError={(text) => onMessage({ tone: 'error', text })}
          onAdded={(name) => {
            setAdding(false);
            afterChange(`${name} now has a seat.`);
          }}
        />
      )}

      {editing && (
        <EditUserModal
          member={editing}
          actor={actor}
          onClose={() => setEditing(null)}
          onError={(text) => onMessage({ tone: 'error', text })}
          onSaved={(name) => {
            setEditing(null);
            afterChange(`${name} updated.`);
          }}
        />
      )}

      {removing && (
        <RemoveUserModal
          member={removing}
          onClose={() => setRemoving(null)}
          onError={(text) => onMessage({ tone: 'error', text })}
          onRemoved={(name) => {
            setRemoving(null);
            afterChange(`${name} was removed.`);
          }}
        />
      )}
    </>
  );
}

function lockReason(actor: any, member: Member) {
  if (member.role === 'owner') return 'The owner account cannot be changed here';
  if (member.role === 'admin' && actor?.role !== 'owner') {
    return 'Only the owner can manage another admin';
  }
  return 'Not available';
}

// ---------------------------------------------------------------------------
// Table chrome
// ---------------------------------------------------------------------------
function SortableHeader({
  label,
  sortKey,
  active,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (key: SortKey) => void;
}) {
  const on = active.key === sortKey;
  const Icon = active.dir === 'asc' ? ArrowUp : ArrowDown;

  return (
    <th className="px-6 py-3">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cx(
          'flex items-center gap-1.5 text-[13px] font-semibold transition',
          on ? 'text-ink' : 'text-ink-muted hover:text-ink'
        )}
      >
        {label}
        {on && <Icon size={14} />}
      </button>
    </th>
  );
}

function PageButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-lg p-1.5 text-ink-muted transition hover:bg-slate-100 hover:text-ink disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
    >
      <Icon size={16} />
    </button>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard is blocked on insecure origins - nothing useful to say
        }
      }}
      className="shrink-0 rounded p-0.5 text-ink-faint transition hover:text-ink"
    >
      {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Password pair, shared by the add and edit dialogs
// ---------------------------------------------------------------------------
function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        className="input pr-11"
        placeholder={placeholder}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint transition hover:text-ink"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function passwordProblem(password: string, confirm: string, required: boolean) {
  if (!password && !confirm) return required ? 'A password is required' : '';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password !== confirm) return 'The two passwords do not match';
  return '';
}

// ---------------------------------------------------------------------------
// Add user
// ---------------------------------------------------------------------------
function AddUserModal({
  organization,
  onClose,
  onAdded,
  onError,
}: {
  organization: any;
  onClose: () => void;
  onAdded: (name: string) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    jobTitle: '',
    role: 'member' as 'admin' | 'member',
    password: '',
    confirm: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const domains: string[] = organization?.domains || [];

  const submit = async () => {
    const problem = passwordProblem(form.password, form.confirm, true);
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required');
      return;
    }
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { firstName, lastName } = splitName(form.name);
      await organizationsAPI.addMember({
        firstName,
        lastName,
        email: form.email.trim(),
        password: form.password,
        jobTitle: form.jobTitle.trim() || undefined,
        role: form.role,
      });
      onAdded(form.name.trim());
    } catch (err) {
      const text = apiError(err, 'Could not add the user');
      setError(text);
      onError(text);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add User"
      description="Creates a seat straight away. Share the password with them; they can change it later."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={submit}>
            Add user
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Full Name" required>
          <input
            className="input"
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>

        <Field
          label="Email"
          required
          hint={domains.length ? `Must be ${domains.map((d) => `@${d}`).join(' or ')}.` : undefined}
        >
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Job title">
            <input
              className="input"
              value={form.jobTitle}
              onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'member' })}
            >
              <option value="member">Standard</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
        </div>

        <Field label="Password" required hint="At least 8 characters.">
          <PasswordInput
            value={form.password}
            onChange={(password) => setForm({ ...form, password })}
            placeholder="New Password"
          />
        </Field>
        <Field label="Confirm password" required>
          <PasswordInput
            value={form.confirm}
            onChange={(confirm) => setForm({ ...form, confirm })}
            placeholder="Confirm New Password"
          />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit user
// ---------------------------------------------------------------------------
function EditUserModal({
  member,
  actor,
  onClose,
  onSaved,
  onError,
}: {
  member: Member;
  actor: any;
  onClose: () => void;
  onSaved: (name: string) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: fullName(member),
    jobTitle: member.jobTitle || '',
    role: (member.role === 'owner' ? 'admin' : member.role) as 'admin' | 'member',
    emailAlerts: member.preferences?.emailAlerts !== false,
    password: '',
    confirm: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const self = isSelf(actor, member);
  const dirty =
    form.name !== fullName(member) ||
    form.jobTitle !== (member.jobTitle || '') ||
    form.role !== member.role ||
    form.emailAlerts !== (member.preferences?.emailAlerts !== false) ||
    Boolean(form.password || form.confirm);

  const submit = async () => {
    const problem = passwordProblem(form.password, form.confirm, false);
    if (problem) {
      setError(problem);
      return;
    }
    if (!form.name.trim()) {
      setError('A name is required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { firstName, lastName } = splitName(form.name);
      await organizationsAPI.updateMember(member._id, {
        firstName,
        lastName,
        jobTitle: form.jobTitle.trim(),
        // Role is the one field an admin cannot change on their own account
        ...(self || form.role === member.role ? {} : { role: form.role }),
        emailAlerts: form.emailAlerts,
        ...(form.password ? { password: form.password } : {}),
      });
      onSaved(form.name.trim());
    } catch (err) {
      const text = apiError(err, 'Could not update the user');
      setError(text);
      onError(text);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit User: ${fullName(member)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} disabled={!dirty} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        <section className="space-y-5">
          <h3 className="text-base font-bold text-ink">Account</h3>

          <Field label="Email" hint="The sign-in address cannot be changed.">
            <input className="input" value={member.email} disabled readOnly />
          </Field>

          <Field label="Full Name" required>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Job title">
              <input
                className="input"
                value={form.jobTitle}
                onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
              />
            </Field>
            <Field
              label="Role"
              hint={self ? 'You cannot change your own role.' : 'Admins can manage users.'}
            >
              <select
                className="input"
                disabled={self}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'member' })}
              >
                <option value="member">Standard</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-base font-bold text-ink">Settings</h3>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
              checked={form.emailAlerts}
              onChange={(e) => setForm({ ...form, emailAlerts: e.target.checked })}
            />
            Email alerts and digests enabled
          </label>
        </section>

        <section className="space-y-5">
          <h3 className="text-base font-bold text-ink">Security</h3>
          <p className="-mt-3 text-[13px] text-ink-muted">
            Leave both boxes empty to keep the current password.
          </p>

          <PasswordInput
            value={form.password}
            onChange={(password) => setForm({ ...form, password })}
            placeholder="New Password"
          />
          <PasswordInput
            value={form.confirm}
            onChange={(confirm) => setForm({ ...form, confirm })}
            placeholder="Confirm New Password"
          />
        </section>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Remove user
// ---------------------------------------------------------------------------
function RemoveUserModal({
  member,
  onClose,
  onRemoved,
  onError,
}: {
  member: Member;
  onClose: () => void;
  onRemoved: (name: string) => void;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await organizationsAPI.removeMember(member._id);
      onRemoved(fullName(member));
    } catch (err) {
      onError(apiError(err, 'Could not remove the user'));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Remove ${fullName(member)}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={saving} onClick={submit}>
            Remove user
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        {member.email} loses access immediately and the seat is freed. Accounts and reports they
        created stay with your company.
      </p>
    </Modal>
  );
}
