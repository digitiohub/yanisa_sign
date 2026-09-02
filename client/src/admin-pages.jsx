import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity, ArrowLeft, ChevronDown, ChevronRight, FileText, Loader2, Lock, Mail, MoreVertical, Plus,
  RefreshCw, Search, Send, ShieldAlert, ShieldCheck, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import { api, errorText, formatDate, formatDateTime, initials, timeAgo } from './api';
import { useAuth } from './auth-context';

const STATUS_STYLE = { active: 'status-signed', invited: 'status-pending-signature', inactive: 'status-draft', suspended: 'status-declined' };

function AdminFrame({ title, subtitle, actions, children }) {
  const { pathname } = window.location;
  const auth = useAuth();
  const tabs = [
    ['/admin', 'Overview', Activity, null],
    ['/admin/users', 'Users', Users, 'users.view'],
    ['/admin/roles', 'Roles', ShieldCheck, 'roles.view'],
    ['/admin/activity', 'Activity', Activity, 'activity.view'],
    ['/admin/audit', 'Audit log', Lock, 'audit.view'],
  ].filter(([, , , permission]) => !permission || auth.can(permission));
  return <main className="mx-auto max-w-[1500px] p-5 lg:p-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
    <nav className="tab-bar">{tabs.map(([to, label, Icon]) => (
      <Link key={to} to={to} className={pathname === to ? 'active' : ''}><Icon size={16} />{label}</Link>
    ))}</nav>
    {children}
  </main>;
}

export function AdminDashboard() {
  const [data, setData] = useState(null);
  const [online, setOnline] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/admin/dashboard').then(response => setData(response.data)).catch(failure => setError(errorText(failure)));
    api.get('/admin/online').then(response => setOnline(response.data)).catch(() => {});
  }, []);
  // Recent activity refreshes on a timer - no live screen watching.
  useEffect(() => { load(); const timer = setInterval(load, 20000); return () => clearInterval(timer); }, [load]);

  const cards = data?.cards || {};
  const tiles = [
    ['Total users', cards.totalUsers, Users], ['Active users', cards.activeUsers, ShieldCheck], ['Pending invitations', cards.invitedUsers, Mail],
    ['Documents created', cards.documentsCreated, FileText], ['Documents sent', cards.documentsSent, Send],
    ['Awaiting signature', cards.pending, Activity], ['Completed', cards.completed, ShieldCheck], ['Declined or cancelled', cards.declined, ShieldAlert],
  ];

  return <AdminFrame title="Overview" subtitle="Users, documents and what your team has been doing.">
    {error && <div className="error-box">{error}</div>}
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map(([label, value, Icon]) => <div key={label} className="card flex items-center gap-4">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Icon size={20} /></span>
        <div><b className="text-2xl">{value ?? '—'}</b><p className="text-sm text-slate-500">{label}</p></div>
      </div>)}
    </div>

    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="card-title"><Activity size={17} />Recent activity</h2>
          <Link className="link-button" to="/admin/activity">View all</Link>
        </div>
        <ol className="timeline mt-4">
          {(data?.recentActivity || []).map(event => <li key={event._id}>
            <span className="timeline-dot" />
            <div>
              <b>{event.description}</b>
              <p>{timeAgo(event.createdAt)} · {event.action}{event.ipAddress ? ` · ${event.ipAddress}` : ''}</p>
            </div>
          </li>)}
          {!data?.recentActivity?.length && <p className="text-sm text-slate-500">Nothing recorded yet.</p>}
        </ol>
      </div>

      <div className="card">
        <h2 className="card-title"><Users size={17} />Who is around</h2>
        <div className="mt-4 space-y-3">
          {online.map(user => <div key={user.id} className="flex items-center gap-3">
            <span className={`presence presence-${user.presence}`} />
            <div className="min-w-0 flex-1">
              <b className="block truncate text-sm">{user.fullName}</b>
              <span className="text-xs text-slate-500">{user.presence === 'online' ? 'Online now' : `Last active ${timeAgo(user.lastActivityAt)}`}</span>
            </div>
          </div>)}
          {!online.length && <p className="text-sm text-slate-500">No active users.</p>}
        </div>
      </div>
    </div>
  </AdminFrame>;
}

function AddUserModal({ roles, workspaces, onClose, onCreated }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', roleId: '', workspaceId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!form.roleId && roles.length) setForm(current => ({ ...current, roleId: roles.find(role => role.key === 'editor')?._id || roles[0]._id })); }, [roles]);

  const submit = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/admin/users', { ...form, workspaceId: form.workspaceId || undefined, phone: form.phone || undefined });
      onCreated(data);
    } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  };

  return <div className="modal-backdrop">
    <form className="modal max-w-lg" onSubmit={submit}>
      <div className="flex items-start justify-between">
        <div><p className="eyebrow">Users</p><h2 className="text-xl font-semibold">Add a user</h2></div>
        <button type="button" onClick={onClose}><X /></button>
      </div>
      <p className="mt-2 text-sm text-slate-500">They receive an invitation with a verification code and choose their own password. You never set or see it.</p>
      {error && <div className="error-box">{error}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field-label">First name<input required autoFocus value={form.firstName} onChange={event => setForm({ ...form, firstName: event.target.value })} /></label>
        <label className="field-label">Last name<input value={form.lastName} onChange={event => setForm({ ...form, lastName: event.target.value })} /></label>
        <label className="field-label sm:col-span-2">Email<input type="email" required value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
        <label className="field-label">Phone<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
        <label className="field-label">Role
          <select value={form.roleId} onChange={event => setForm({ ...form, roleId: event.target.value })}>
            {roles.filter(role => role.assignable).map(role => <option key={role._id} value={role._id}>{role.name}</option>)}
          </select>
        </label>
        <label className="field-label sm:col-span-2">Team / workspace
          <select value={form.workspaceId} onChange={event => setForm({ ...form, workspaceId: event.target.value })}>
            <option value="">Same as mine</option>
            {workspaces.map(workspace => <option key={workspace._id} value={workspace._id}>{workspace.name}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button className="primary-button" disabled={busy}>{busy && <Loader2 className="animate-spin" size={16} />}Send invitation</button>
      </div>
    </form>
  </div>;
}

export function UsersPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [filters, setFilters] = useState({ q: '', status: '', roleId: '', workspaceId: '' });
  const [busy, setBusy] = useState(true);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [menuFor, setMenuFor] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const { data } = await api.get('/admin/users', { params });
      setUsers(data.users);
    } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/admin/roles').then(({ data }) => setRoles(data)).catch(() => {});
    api.get('/admin/workspaces').then(({ data }) => setWorkspaces(data)).catch(() => {});
  }, []);

  const act = async (user, action, label) => {
    setMenuFor(null); setError(''); setMessage('');
    try { const { data } = await api.post(`/admin/users/${user.id}/${action}`); setMessage(data.message || `${user.fullName}: ${label} done.`); load(); }
    catch (failure) { setError(errorText(failure)); }
  };
  const remove = async user => {
    setMenuFor(null);
    if (!confirm(`Remove ${user.fullName}? Their documents and history are kept.`)) return;
    try { await api.delete(`/admin/users/${user.id}`); setMessage(`${user.fullName} was removed.`); load(); }
    catch (failure) { setError(errorText(failure)); }
  };

  return <AdminFrame
    title="Users"
    subtitle="Invite colleagues, set their role and control their access."
    actions={auth.can('users.create') && <button className="primary-button" onClick={() => setAdding(true)}><UserPlus size={17} />Add user</button>}
  >
    {message && <div className="info-box">{message}</div>}
    {error && <div className="error-box">{error}</div>}
    <div className="card mt-6 p-0">
      <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
          <input className="w-full pl-10" placeholder="Search name or email" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} />
        </div>
        <select value={filters.roleId} onChange={event => setFilters({ ...filters, roleId: event.target.value })}>
          <option value="">All roles</option>
          {roles.map(role => <option key={role._id} value={role._id}>{role.name}</option>)}
        </select>
        <select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}>
          <option value="">All statuses</option>
          {['active', 'invited', 'inactive', 'suspended'].map(status => <option key={status} value={status}>{status}</option>)}
        </select>
        <select value={filters.workspaceId} onChange={event => setFilters({ ...filters, workspaceId: event.target.value })}>
          <option value="">All teams</option>
          {workspaces.map(workspace => <option key={workspace._id} value={workspace._id}>{workspace.name}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Team</th><th>Status</th><th>Last login</th><th>Created</th><th /></tr></thead>
          <tbody>
            {busy ? <tr><td colSpan="7" className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-brand-600" /></td></tr>
              : users.length === 0 ? <tr><td colSpan="7" className="py-16 text-center text-slate-500">No users match these filters.</td></tr>
                : users.map(user => <tr key={user.id}>
                  <td>
                    <button className="flex items-center gap-3 text-left" onClick={() => navigate(`/admin/users/${user.id}`)}>
                      <span className="avatar">{initials(user)}</span>
                      <span><b className="block">{user.fullName}</b><small className="text-slate-500">{user.email}</small></span>
                    </button>
                  </td>
                  <td>{user.role?.name || '—'}</td>
                  <td>{user.workspace?.name || '—'}</td>
                  <td><span className={`status ${STATUS_STYLE[user.status] || ''}`}>{user.status}</span></td>
                  <td>{user.lastLoginAt ? timeAgo(user.lastLoginAt) : 'never'}</td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <div className="relative flex justify-end">
                      <button className="icon-button" onClick={() => setMenuFor(menuFor === user.id ? null : user.id)}><MoreVertical size={17} /></button>
                      {menuFor === user.id && <div className="menu">
                        <button onClick={() => navigate(`/admin/users/${user.id}`)}>View details</button>
                        {auth.can('users.edit') && user.status !== 'active' && <button onClick={() => act(user, 'activate', 'activated')}>Activate</button>}
                        {auth.can('users.edit') && user.status === 'active' && <button onClick={() => act(user, 'deactivate', 'deactivated')}>Deactivate</button>}
                        {auth.can('users.edit') && user.status !== 'suspended' && <button onClick={() => act(user, 'suspend', 'suspended')}>Suspend</button>}
                        {auth.can('users.create') && user.status === 'invited' && <button onClick={() => act(user, 'resend-invitation', 'invitation resent')}>Resend invitation</button>}
                        {auth.can('users.edit') && <button onClick={() => act(user, 'reset-access', 'access reset')}>Reset access</button>}
                        {auth.can('sessions.revoke') && <button onClick={() => act(user, 'revoke-sessions', 'sessions revoked')}>Revoke sessions</button>}
                        {auth.can('users.delete') && <button className="danger" onClick={() => remove(user)}>Remove user</button>}
                      </div>}
                    </div>
                  </td>
                </tr>)}
          </tbody>
        </table>
      </div>
    </div>
    {adding && <AddUserModal roles={roles} workspaces={workspaces} onClose={() => setAdding(false)} onCreated={user => { setAdding(false); setMessage(`Invitation sent to ${user.email}.`); load(); }} />}
  </AdminFrame>;
}

export function UserDetailPage() {
  const { id } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [roles, setRoles] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => api.get(`/admin/users/${id}`).then(({ data }) => setDetail(data)).catch(failure => setError(errorText(failure))), [id]);
  useEffect(() => { load(); api.get('/admin/roles').then(({ data }) => setRoles(data)).catch(() => {}); api.get('/admin/workspaces').then(({ data }) => setWorkspaces(data)).catch(() => {}); }, [load]);

  const update = async changes => {
    setError(''); setMessage('');
    try { await api.patch(`/admin/users/${id}`, changes); setMessage('User updated.'); load(); }
    catch (failure) { setError(errorText(failure)); }
  };
  const act = async (action, label) => {
    setError(''); setMessage('');
    try { const { data } = await api.post(`/admin/users/${id}/${action}`); setMessage(data.message || `${label} done.`); load(); }
    catch (failure) { setError(errorText(failure)); }
  };

  if (!detail) return <AdminFrame title="User"><div className="loading"><Loader2 className="animate-spin" /></div></AdminFrame>;
  const { user, stats, sessions, activity, failedLogins, recentDocuments } = detail;

  return <AdminFrame title={user.fullName} subtitle={user.email} actions={<button className="secondary-button" onClick={() => navigate('/admin/users')}><ArrowLeft size={16} />All users</button>}>
    {message && <div className="info-box">{message}</div>}
    {error && <div className="error-box">{error}</div>}
    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="space-y-5">
        <div className="card">
          <h2 className="card-title">User information</h2>
          <dl className="detail-list">
            <div><dt>Status</dt><dd><span className={`status ${STATUS_STYLE[user.status] || ''}`}>{user.status}</span></dd></div>
            <div><dt>Role</dt><dd>{auth.can('users.edit')
              ? <select value={user.role?.id || ''} onChange={event => update({ roleId: event.target.value })}>
                {roles.filter(role => role.assignable).map(role => <option key={role._id} value={role._id}>{role.name}</option>)}
              </select>
              : user.role?.name}</dd></div>
            <div><dt>Team</dt><dd>{auth.can('users.edit')
              ? <select value={user.workspace?.id || ''} onChange={event => update({ workspaceId: event.target.value || null })}>
                <option value="">No team</option>
                {workspaces.map(workspace => <option key={workspace._id} value={workspace._id}>{workspace.name}</option>)}
              </select>
              : user.workspace?.name || '—'}</dd></div>
            <div><dt>Email verified</dt><dd>{user.emailVerified ? 'Yes' : 'No'}</dd></div>
            <div><dt>Phone</dt><dd>{user.phone || '—'}</dd></div>
            <div><dt>Last login</dt><dd>{formatDateTime(user.lastLoginAt)}</dd></div>
            <div><dt>Last login IP</dt><dd>{user.lastLoginIp || '—'}</dd></div>
            <div><dt>Password changed</dt><dd>{formatDateTime(user.passwordChangedAt)}</dd></div>
            <div><dt>Created</dt><dd>{formatDateTime(user.createdAt)}</dd></div>
          </dl>
        </div>

        <div className="card">
          <h2 className="card-title">Admin actions</h2>
          <p className="text-xs text-slate-500">Passwords are never visible to administrators. Reset access ends every session and emails a fresh code.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {auth.can('users.edit') && user.status !== 'active' && <button className="secondary-button" onClick={() => act('activate', 'Activation')}>Activate</button>}
            {auth.can('users.edit') && user.status === 'active' && <button className="secondary-button" onClick={() => act('deactivate', 'Deactivation')}>Deactivate</button>}
            {auth.can('users.edit') && <button className="secondary-button" onClick={() => act('suspend', 'Suspension')}>Suspend</button>}
            {auth.can('users.edit') && <button className="secondary-button" onClick={() => act('reset-access', 'Access reset')}><RefreshCw size={15} />Reset access</button>}
            {auth.can('sessions.revoke') && <button className="secondary-button" onClick={() => act('revoke-sessions', 'Session revocation')}>Revoke sessions</button>}
            {auth.can('users.create') && user.status === 'invited' && <button className="secondary-button" onClick={() => act('resend-invitation', 'Invitation')}><Mail size={15} />Resend invitation</button>}
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">Security</h2>
          <p className="text-sm text-slate-500">{sessions.length} active session(s)</p>
          <div className="mt-3 space-y-2 text-sm">
            {sessions.map(session => <div key={session.id} className="flex justify-between gap-3">
              <span>{session.browser} · {session.os}</span>
              <span className="text-xs text-slate-500">{timeAgo(session.lastActivityAt)}</span>
            </div>)}
            {!sessions.length && <p className="text-sm text-slate-500">No active sessions.</p>}
          </div>
          <h3 className="mt-5 text-sm font-semibold">Recent failed sign-ins</h3>
          <div className="mt-2 space-y-1 text-xs text-slate-500">
            {failedLogins.map(attempt => <p key={attempt._id}>{formatDateTime(attempt.createdAt)} · {attempt.reason} · {attempt.ipAddress}</p>)}
            {!failedLogins.length && <p>None recorded.</p>}
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {[['Documents created', stats.documentsCreated], ['Documents sent', stats.documentsSent], ['Documents edited', stats.documentsEdited]].map(([label, value]) => (
            <div key={label} className="card"><b className="text-2xl">{value}</b><p className="text-sm text-slate-500">{label}</p></div>
          ))}
        </div>

        <div className="card">
          <h2 className="card-title"><FileText size={17} />Recent documents</h2>
          <table className="mt-2">
            <thead><tr><th>Document</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>{recentDocuments.map(doc => <tr key={doc._id}>
              <td><Link className="link-button" to={`/documents/${doc._id}/design`}>{doc.title}</Link><small className="block text-slate-500">{doc.referenceNumber}</small></td>
              <td><span className={`status status-${doc.status.toLowerCase().replaceAll(' ', '-')}`}>{doc.status}</span></td>
              <td>{formatDate(doc.updatedAt)}</td>
            </tr>)}
            {!recentDocuments.length && <tr><td colSpan="3" className="text-slate-500">No documents yet.</td></tr>}</tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="card-title"><Activity size={17} />Recent activity</h2>
          <ol className="timeline mt-3">
            {activity.map(event => <li key={event._id}>
              <span className="timeline-dot" />
              <div><b>{event.description}</b><p>{formatDateTime(event.createdAt)} · {event.action}</p></div>
            </li>)}
            {!activity.length && <p className="text-sm text-slate-500">Nothing recorded yet.</p>}
          </ol>
        </div>
      </div>
    </div>
  </AdminFrame>;
}

function EventDetail({ event, onClose }) {
  const pairs = value => Object.entries(value || {});
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal max-w-2xl" onClick={event2 => event2.stopPropagation()}>
      <div className="flex items-start justify-between">
        <div><p className="eyebrow">{event.category === 'security' ? 'Audit event' : 'Activity'}</p><h2 className="text-xl font-semibold">{event.description}</h2></div>
        <button onClick={onClose}><X /></button>
      </div>
      <dl className="detail-list mt-4">
        <div><dt>Action</dt><dd><code>{event.action}</code></dd></div>
        <div><dt>Actor</dt><dd>{event.actorName || event.actorEmail || 'System'} ({event.actorType})</dd></div>
        <div><dt>When</dt><dd>{formatDateTime(event.createdAt)}</dd></div>
        <div><dt>Entity</dt><dd>{event.entityType}{event.entityLabel ? ` · ${event.entityLabel}` : ''}</dd></div>
        <div><dt>IP address</dt><dd>{event.ipAddress || '—'}</dd></div>
        <div><dt>Device</dt><dd className="truncate">{event.userAgent || '—'}</dd></div>
      </dl>
      {(event.before || event.after) && <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div><h3 className="text-sm font-semibold text-slate-500">Before</h3><div className="diff-box">{pairs(event.before).map(([key, value]) => <p key={key}><b>{key}</b><span>{JSON.stringify(value)}</span></p>)}{!pairs(event.before).length && <p className="text-slate-400">—</p>}</div></div>
        <div><h3 className="text-sm font-semibold text-slate-500">After</h3><div className="diff-box">{pairs(event.after).map(([key, value]) => <p key={key}><b>{key}</b><span>{JSON.stringify(value)}</span></p>)}{!pairs(event.after).length && <p className="text-slate-400">—</p>}</div></div>
      </div>}
      {event.metadata && <div className="mt-4"><h3 className="text-sm font-semibold text-slate-500">Details</h3><div className="diff-box">{pairs(event.metadata).map(([key, value]) => <p key={key}><b>{key}</b><span>{JSON.stringify(value)}</span></p>)}</div></div>}
    </div>
  </div>;
}

function EventLog({ title, subtitle, endpoint }) {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState([]);
  const [actions, setActions] = useState([]);
  const [filters, setFilters] = useState({ q: '', actorUserId: '', module: '', action: '', from: '', to: '' });
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(50);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = { ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), limit };
      const { data } = await api.get(endpoint, { params });
      setEvents(data.events); setTotal(data.total);
    } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }, [endpoint, filters, limit]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/admin/users', { params: { limit: 200 } }).then(({ data }) => setUsers(data.users)).catch(() => {});
    api.get('/admin/actions').then(({ data }) => setActions(data.sort())).catch(() => {});
  }, []);

  const modules = useMemo(() => [...new Set(actions.map(action => action.split('.')[0]))].sort(), [actions]);

  return <AdminFrame title={title} subtitle={subtitle}>
    {error && <div className="error-box">{error}</div>}
    <div className="card mt-6 p-0">
      <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
          <input className="w-full pl-10" placeholder="Search description, user or action" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} />
        </div>
        <select value={filters.actorUserId} onChange={event => setFilters({ ...filters, actorUserId: event.target.value })}>
          <option value="">All users</option>
          {users.map(user => <option key={user.id} value={user.id}>{user.fullName}</option>)}
        </select>
        <select value={filters.module} onChange={event => setFilters({ ...filters, module: event.target.value })}>
          <option value="">All modules</option>
          {modules.map(module => <option key={module} value={module}>{module}</option>)}
        </select>
        <select value={filters.action} onChange={event => setFilters({ ...filters, action: event.target.value })}>
          <option value="">All actions</option>
          {actions.map(action => <option key={action} value={action}>{action}</option>)}
        </select>
        <input type="date" value={filters.from} onChange={event => setFilters({ ...filters, from: event.target.value })} />
        <input type="date" value={filters.to} onChange={event => setFilters({ ...filters, to: event.target.value })} />
      </div>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>When</th><th>User</th><th>Event</th><th>Action</th><th>IP</th><th /></tr></thead>
          <tbody>
            {busy ? <tr><td colSpan="6" className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-brand-600" /></td></tr>
              : events.length === 0 ? <tr><td colSpan="6" className="py-16 text-center text-slate-500">Nothing matches these filters.</td></tr>
                : events.map(event => <tr key={event._id} className="cursor-pointer" onClick={() => setSelected(event)}>
                  <td className="whitespace-nowrap"><b>{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b><small className="block text-slate-500">{formatDate(event.createdAt)}</small></td>
                  <td>{event.actorName || event.actorEmail || 'System'}<small className="block text-slate-500">{event.actorType}</small></td>
                  <td>{event.description}</td>
                  <td><code className="text-xs">{event.action}</code></td>
                  <td className="text-xs text-slate-500">{event.ipAddress || '—'}</td>
                  <td><ChevronRight size={16} className="text-slate-400" /></td>
                </tr>)}
          </tbody>
        </table>
      </div>
      {events.length < total && <div className="border-t border-slate-200 p-3 text-center">
        <button className="secondary-button" onClick={() => setLimit(limit + 50)}><ChevronDown size={16} />Load more ({events.length} of {total})</button>
      </div>}
    </div>
    {selected && <EventDetail event={selected} onClose={() => setSelected(null)} />}
  </AdminFrame>;
}

export const ActivityPage = () => <EventLog title="Activity log" subtitle="What everyone has been doing, newest first." endpoint="/admin/activity" />;
export const AuditPage = () => <EventLog title="Audit log" subtitle="Security and administrative events: roles, access, sessions and accounts." endpoint="/admin/audit-logs" />;

export function RolesPage() {
  const auth = useAuth();
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(() => api.get('/admin/roles').then(({ data }) => setRoles(data)).catch(failure => setError(errorText(failure))), []);
  useEffect(() => { load(); api.get('/admin/permissions').then(({ data }) => setPermissions(data)).catch(() => {}); }, [load]);

  const modules = useMemo(() => {
    const grouped = new Map();
    for (const permission of permissions) {
      if (!grouped.has(permission.module)) grouped.set(permission.module, []);
      grouped.get(permission.module).push(permission);
    }
    return [...grouped.entries()];
  }, [permissions]);

  const draft = editing || creating;
  const toggle = key => {
    const next = draft.permissions.includes(key) ? draft.permissions.filter(item => item !== key) : [...draft.permissions, key];
    (editing ? setEditing : setCreating)({ ...draft, permissions: next });
  };
  const save = async () => {
    setError(''); setMessage('');
    try {
      if (editing) await api.patch(`/admin/roles/${editing._id}`, { name: editing.name, description: editing.description, permissions: editing.permissions });
      else await api.post('/admin/roles', { name: creating.name, description: creating.description, rank: creating.rank, permissions: creating.permissions });
      setEditing(null); setCreating(null); setMessage('Role saved.'); load();
    } catch (failure) { setError(errorText(failure)); }
  };
  const remove = async role => {
    if (!confirm(`Delete the role "${role.name}"?`)) return;
    try { await api.delete(`/admin/roles/${role._id}`); load(); }
    catch (failure) { setError(errorText(failure)); }
  };

  return <AdminFrame
    title="Roles and permissions"
    subtitle="Built-in roles cover most teams. Create your own for anything else."
    actions={auth.can('roles.create') && <button className="primary-button" onClick={() => setCreating({ name: '', description: '', rank: 30, permissions: [] })}><Plus size={17} />New role</button>}
  >
    {message && <div className="info-box">{message}</div>}
    {error && <div className="error-box">{error}</div>}
    <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {roles.map(role => <div key={role._id} className="card">
        <div className="flex items-start justify-between">
          <div>
            <b className="text-lg">{role.name}</b>
            <p className="text-sm text-slate-500">{role.description}</p>
          </div>
          {role.isSystem ? <span className="status status-draft">Built-in</span> : <span className="status status-signed">Custom</span>}
        </div>
        <p className="mt-3 text-xs uppercase tracking-wide text-slate-400">{role.userCount} user(s)</p>
        <div className="mt-3 flex flex-wrap gap-1">
          {(role.permissions.includes('*') ? ['Everything'] : role.permissions.slice(0, 6)).map(permission => <span key={permission} className="chip">{permission}</span>)}
          {role.permissions.length > 6 && !role.permissions.includes('*') && <span className="chip">+{role.permissions.length - 6}</span>}
        </div>
        {!role.isSystem && auth.can('roles.edit') && <div className="mt-4 flex gap-2">
          <button className="secondary-button" onClick={() => setEditing({ ...role })}>Edit</button>
          {auth.can('roles.delete') && <button className="icon-button text-red-600" onClick={() => remove(role)}><Trash2 size={16} /></button>}
        </div>}
      </div>)}
    </div>

    {draft && <div className="modal-backdrop">
      <div className="modal max-w-3xl">
        <div className="flex items-start justify-between">
          <div><p className="eyebrow">Roles</p><h2 className="text-xl font-semibold">{editing ? `Edit ${editing.name}` : 'New role'}</h2></div>
          <button onClick={() => { setEditing(null); setCreating(null); }}><X /></button>
        </div>
        <p className="mt-2 text-sm text-slate-500">You can only grant permissions you hold yourself.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field-label">Role name<input value={draft.name} onChange={event => (editing ? setEditing : setCreating)({ ...draft, name: event.target.value })} /></label>
          <label className="field-label">Description<input value={draft.description || ''} onChange={event => (editing ? setEditing : setCreating)({ ...draft, description: event.target.value })} /></label>
        </div>
        <div className="mt-5 max-h-80 overflow-y-auto pr-1">
          {modules.map(([module, items]) => <div key={module} className="mb-4">
            <h3 className="text-sm font-semibold capitalize">{module}</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {items.map(permission => <label key={permission.key} className="checkbox-label">
                <input type="checkbox" checked={draft.permissions.includes(permission.key)} onChange={() => toggle(permission.key)} disabled={!auth.can(permission.key)} />
                <span><b>{permission.key}</b><small className="block text-slate-500">{permission.description}</small></span>
              </label>)}
            </div>
          </div>)}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={() => { setEditing(null); setCreating(null); }}>Cancel</button>
          <button className="primary-button" onClick={save}>Save role</button>
        </div>
      </div>
    </div>}
  </AdminFrame>;
}
