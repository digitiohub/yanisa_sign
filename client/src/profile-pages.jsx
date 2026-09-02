import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, KeyRound, Loader2, Monitor, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { api, errorText, formatDateTime, initials, timeAgo } from './api';
import { useAuth } from './auth-context';
import { PasswordStrength } from './auth-pages';

function ProfileTabs() {
  const { pathname } = useLocation();
  const tabs = [['/profile', 'Profile', UserCog], ['/profile/security', 'Security', ShieldCheck], ['/profile/activity', 'Activity', Activity]];
  return <nav className="tab-bar">{tabs.map(([to, label, Icon]) => (
    <Link key={to} to={to} className={pathname === to ? 'active' : ''}><Icon size={16} />{label}</Link>
  ))}</nav>;
}

function ProfileFrame({ children }) {
  const { user, company, workspace } = useAuth();
  return <main className="mx-auto max-w-4xl p-5 lg:p-8">
    <div className="flex items-center gap-4">
      <span className="avatar-lg">{initials(user)}</span>
      <div>
        <p className="eyebrow">My account</p>
        <h1 className="text-2xl font-semibold">{user?.fullName}</h1>
        <p className="text-sm text-slate-500">{user?.role?.name} · {company?.name}{workspace ? ` · ${workspace.name}` : ''}</p>
      </div>
    </div>
    <ProfileTabs />
    {children}
  </main>;
}

export function ProfilePage() {
  const { user, reload } = useAuth();
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '' });
  const [emailForm, setEmailForm] = useState({ email: '', password: '', otp: '', stage: 'idle' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) setForm({ firstName: user.firstName || '', lastName: user.lastName || '', phone: user.phone || '' }); }, [user]);

  const save = async event => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try { await api.patch('/auth/profile', form); await reload(); setMessage('Profile updated.'); }
    catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  };
  const requestEmailChange = async () => {
    setError(''); setMessage('');
    try { const { data } = await api.post('/auth/email-change/request', { email: emailForm.email, password: emailForm.password }); setEmailForm({ ...emailForm, stage: 'otp' }); setMessage(`We sent a code to ${data.maskedEmail}.`); }
    catch (failure) { setError(errorText(failure)); }
  };
  const confirmEmailChange = async () => {
    setError('');
    try { await api.post('/auth/email-change/verify', { email: emailForm.email, otp: emailForm.otp }); setMessage('Email updated. Sign in again with your new address.'); setEmailForm({ email: '', password: '', otp: '', stage: 'idle' }); }
    catch (failure) { setError(errorText(failure)); }
  };

  return <ProfileFrame>
    {message && <div className="info-box">{message}</div>}
    {error && <div className="error-box">{error}</div>}
    <form className="card mt-5" onSubmit={save}>
      <h2 className="card-title">Profile information</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field-label">First name<input value={form.firstName} onChange={event => setForm({ ...form, firstName: event.target.value })} /></label>
        <label className="field-label">Last name<input value={form.lastName} onChange={event => setForm({ ...form, lastName: event.target.value })} /></label>
        <label className="field-label">Phone<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
        <label className="field-label">Role<input value={user?.role?.name || ''} disabled /></label>
      </div>
      <button className="primary-button mt-5" disabled={busy}>{busy && <Loader2 className="animate-spin" size={16} />}Save changes</button>
    </form>

    <div className="card mt-5">
      <h2 className="card-title">Email address</h2>
      <p className="text-sm text-slate-500">Your current address is <b>{user?.email}</b>. Changing it needs a code sent to the new address.</p>
      {emailForm.stage === 'idle' && <button className="secondary-button mt-4" onClick={() => setEmailForm({ ...emailForm, stage: 'form' })}>Change email address</button>}
      {emailForm.stage === 'form' && <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="field-label">New email<input type="email" value={emailForm.email} onChange={event => setEmailForm({ ...emailForm, email: event.target.value })} /></label>
        <label className="field-label">Your password<input type="password" value={emailForm.password} onChange={event => setEmailForm({ ...emailForm, password: event.target.value })} /></label>
        <div className="sm:col-span-2 flex gap-2">
          <button className="primary-button" onClick={requestEmailChange}>Send code</button>
          <button className="secondary-button" onClick={() => setEmailForm({ email: '', password: '', otp: '', stage: 'idle' })}>Cancel</button>
        </div>
      </div>}
      {emailForm.stage === 'otp' && <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="field-label">Verification code<input value={emailForm.otp} maxLength={6} onChange={event => setEmailForm({ ...emailForm, otp: event.target.value.replace(/\D/g, '') })} /></label>
        <button className="primary-button" onClick={confirmEmailChange}>Confirm new email</button>
      </div>}
    </div>
  </ProfileFrame>;
}

export function SecurityPage() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [sessions, setSessions] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSessions = () => api.get('/auth/sessions').then(({ data }) => setSessions(data)).catch(() => {});
  useEffect(() => { loadSessions(); }, []);

  const changePassword = async event => {
    event.preventDefault();
    if (form.newPassword !== form.confirmPassword) return setError('The two passwords do not match.');
    setBusy(true); setError(''); setMessage('');
    try {
      await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMessage('Password changed. Every other device has been signed out.');
      loadSessions();
    } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  };
  const revoke = async id => { await api.delete(`/auth/sessions/${id}`); loadSessions(); };
  const revokeOthers = async () => { const { data } = await api.delete('/auth/sessions'); setMessage(`Signed out of ${data.revoked} other device(s).`); loadSessions(); };

  return <ProfileFrame>
    {message && <div className="info-box">{message}</div>}
    {error && <div className="error-box">{error}</div>}
    <form className="card mt-5" onSubmit={changePassword}>
      <h2 className="card-title"><KeyRound size={17} />Change password</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field-label sm:col-span-2">Current password<input type="password" autoComplete="current-password" value={form.currentPassword} onChange={event => setForm({ ...form, currentPassword: event.target.value })} /></label>
        <label className="field-label">New password<input type="password" autoComplete="new-password" value={form.newPassword} onChange={event => setForm({ ...form, newPassword: event.target.value })} /></label>
        <label className="field-label">Confirm new password<input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={event => setForm({ ...form, confirmPassword: event.target.value })} /></label>
      </div>
      <PasswordStrength value={form.newPassword} />
      <p className="mt-3 text-xs text-slate-500">Changing your password signs out every other device.</p>
      <button className="primary-button mt-4" disabled={busy}>{busy && <Loader2 className="animate-spin" size={16} />}Update password</button>
    </form>

    <div className="card mt-5">
      <div className="flex items-center justify-between">
        <h2 className="card-title"><Monitor size={17} />Active sessions</h2>
        {sessions.length > 1 && <button className="secondary-button" onClick={revokeOthers}>Sign out other devices</button>}
      </div>
      <div className="mt-3 divide-y divide-slate-100">
        {sessions.map(session => <div key={session.id} className="flex flex-wrap items-center gap-3 py-3">
          <div className="min-w-56 flex-1">
            <b className="text-sm">{session.browser} on {session.os}</b>
            {session.current && <span className="status status-signed ml-2">This device</span>}
            <p className="text-xs text-slate-500">{session.device} · {session.ipAddress || 'unknown IP'}</p>
          </div>
          <div className="text-xs text-slate-500">
            <p>Signed in {formatDateTime(session.createdAt)}</p>
            <p>Last active {timeAgo(session.lastActivityAt)}</p>
          </div>
          <button className="icon-button text-red-600" title="Sign out this device" onClick={() => revoke(session.id)}><Trash2 size={16} /></button>
        </div>)}
        {!sessions.length && <p className="py-4 text-sm text-slate-500">No active sessions.</p>}
      </div>
    </div>
  </ProfileFrame>;
}

export function MyActivityPage() {
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(true);
  useEffect(() => { api.get('/auth/activity?limit=50').then(({ data }) => setEvents(data)).finally(() => setBusy(false)); }, []);
  return <ProfileFrame>
    <div className="card mt-5">
      <h2 className="card-title"><Activity size={17} />Recent activity</h2>
      {busy ? <Loader2 className="mx-auto my-6 animate-spin text-brand-600" /> : <ol className="timeline mt-3">
        {events.map(event => <li key={event._id}>
          <span className="timeline-dot" />
          <div><b>{event.description}</b><p>{formatDateTime(event.createdAt)} · {event.action}</p></div>
        </li>)}
        {!events.length && <p className="text-sm text-slate-500">Nothing recorded yet.</p>}
      </ol>}
    </div>
  </ProfileFrame>;
}
