import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, FileSignature, Loader2, ShieldCheck } from 'lucide-react';
import { api, errorText } from './api';
import { useAuth } from './auth-context';

function AuthShell({ title, subtitle, children, back }) {
  return <div className="auth-page">
    <form className="auth-card" onSubmit={event => event.preventDefault()}>
      <span className="auth-mark"><FileSignature /></span>
      <h1>{title}</h1>
      {subtitle && <p className="auth-subtitle">{subtitle}</p>}
      {children}
      {back && <Link className="auth-back" to={back}><ArrowLeft size={15} />Back to sign in</Link>}
    </form>
  </div>;
}

// Six single-character boxes that behave like one field: typing advances,
// backspace steps back, and a pasted code fills every box.
function OtpInput({ value, onChange, disabled }) {
  const boxes = useRef([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  const setDigit = (index, digit) => {
    const next = digits.map((current, position) => (position === index ? digit : current)).join('').replace(/\s/g, ' ');
    onChange(next.trimEnd());
    if (digit && index < 5) boxes.current[index + 1]?.focus();
  };
  return <div className="otp-input" onPaste={event => {
    const pasted = (event.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    boxes.current[Math.min(pasted.length, 5)]?.focus();
  }}>
    {digits.map((digit, index) => <input
      key={index}
      ref={element => { boxes.current[index] = element; }}
      inputMode="numeric"
      maxLength={1}
      disabled={disabled}
      aria-label={`Digit ${index + 1}`}
      value={digit.trim()}
      onChange={event => setDigit(index, event.target.value.replace(/\D/g, '').slice(-1) || '')}
      onKeyDown={event => {
        if (event.key === 'Backspace' && !digit.trim() && index > 0) boxes.current[index - 1]?.focus();
        if (event.key === 'ArrowLeft' && index > 0) boxes.current[index - 1]?.focus();
        if (event.key === 'ArrowRight' && index < 5) boxes.current[index + 1]?.focus();
      }}
    />)}
  </div>;
}

function ResendButton({ onResend, seconds = 45 }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { const timer = setInterval(() => setLeft(current => (current > 0 ? current - 1 : 0)), 1000); return () => clearInterval(timer); }, []);
  return <p className="auth-hint">Didn&apos;t receive the code?{' '}
    {left > 0
      ? <span className="text-slate-400">Resend in {left}s</span>
      : <button type="button" className="link-button" onClick={() => { setLeft(seconds); onResend(); }}>Resend code</button>}
  </p>;
}

// Live feedback while typing: mirrors the rules the API enforces.
function PasswordStrength({ value }) {
  const rules = [
    ['At least 8 characters', value.length >= 8],
    ['A lowercase letter', /[a-z]/.test(value)],
    ['An uppercase letter', /[A-Z]/.test(value)],
    ['A number', /\d/.test(value)],
    ['A special character', /[^A-Za-z0-9]/.test(value)],
  ];
  const met = rules.filter(([, ok]) => ok).length;
  const level = value.length < 8 ? 0 : Math.min(3, met - 2);
  return <div className="password-strength">
    <div className={`strength-bar level-${Math.max(level, 0)}`}><span /><span /><span /></div>
    <ul>{rules.map(([label, ok]) => <li key={label} className={ok ? 'met' : ''}>{ok ? <Check size={13} /> : <span className="dot" />}{label}</li>)}</ul>
  </div>;
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', rememberMe: true });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (auth.status === 'authenticated') navigate('/', { replace: true }); }, [auth.status, navigate]);

  const submit = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try { await auth.signIn(form); navigate('/', { replace: true }); }
    catch (failure) {
      setError(errorText(failure));
      if (failure.response?.data?.code === 'invitation_pending') navigate(`/accept-invite?email=${encodeURIComponent(form.email)}`);
    } finally { setBusy(false); }
  };

  return <div className="auth-page">
    <form onSubmit={submit} className="auth-card">
      <span className="auth-mark"><FileSignature /></span>
      <h1>Welcome to Yanisa Sign</h1>
      <p className="auth-subtitle">Sign in to prepare, send and track signature requests.</p>
      {error && <div className="error-box">{error}</div>}
      <label className="field-label">Email<input type="email" autoComplete="username" required value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
      <label className="field-label">Password<input type="password" autoComplete="current-password" required value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label>
      <div className="auth-row">
        <label className="checkbox-label"><input type="checkbox" checked={form.rememberMe} onChange={event => setForm({ ...form, rememberMe: event.target.checked })} />Remember me</label>
        <Link className="link-button" to="/forgot-password">Forgot password?</Link>
      </div>
      <button disabled={busy} className="primary-button mt-6 w-full">{busy && <Loader2 className="animate-spin" size={17} />}Sign in</button>
    </form>
  </div>;
}

export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(params.get('email') || '');
  const [masked, setMasked] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setMasked(data.maskedEmail); setNotice(data.message); setStep('otp');
    } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  };
  const verifyCode = async () => {
    setBusy(true); setError('');
    try { const { data } = await api.post('/auth/verify-reset-otp', { email, otp }); setResetToken(data.resetToken); setStep('password'); }
    catch (failure) { setError(errorText(failure)); setOtp(''); } finally { setBusy(false); }
  };
  const savePassword = async () => {
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true); setError('');
    try { await api.post('/auth/reset-password', { resetToken, password }); setStep('done'); }
    catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  };

  if (step === 'done') return <AuthShell title="Password updated" subtitle="Every other session has been signed out for safety.">
    <ShieldCheck className="mx-auto my-4 text-emerald-600" size={40} />
    <button className="primary-button w-full" onClick={() => navigate('/login')}>Back to sign in</button>
  </AuthShell>;

  if (step === 'password') return <AuthShell title="Set a new password" subtitle="Choose a password you have not used before." back="/login">
    {error && <div className="error-box">{error}</div>}
    <label className="field-label">New password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
    <PasswordStrength value={password} />
    <label className="field-label">Confirm new password<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
    <button className="primary-button mt-6 w-full" disabled={busy} onClick={savePassword}>{busy && <Loader2 className="animate-spin" size={17} />}Update password</button>
  </AuthShell>;

  if (step === 'otp') return <AuthShell title="Verify your email" subtitle={`We sent a 6-digit verification code to ${masked || email}.`} back="/login">
    {notice && <div className="info-box">{notice}</div>}
    {error && <div className="error-box">{error}</div>}
    <OtpInput value={otp} onChange={setOtp} disabled={busy} />
    <button className="primary-button mt-5 w-full" disabled={busy || otp.length !== 6} onClick={verifyCode}>{busy && <Loader2 className="animate-spin" size={17} />}Verify</button>
    <ResendButton onResend={requestCode} />
  </AuthShell>;

  return <AuthShell title="Forgot your password?" subtitle="Enter your email and we will send a verification code." back="/login">
    {error && <div className="error-box">{error}</div>}
    <label className="field-label">Email<input type="email" autoFocus value={email} onChange={event => setEmail(event.target.value)} /></label>
    <button className="primary-button mt-6 w-full" disabled={busy || !email} onClick={requestCode}>{busy && <Loader2 className="animate-spin" size={17} />}Send verification code</button>
  </AuthShell>;
}

// Used both for a new invitation and for an admin "reset access".
export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState('otp');
  const [email, setEmail] = useState(params.get('email') || '');
  const [otp, setOtp] = useState('');
  const [invitationToken, setInvitationToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    setError('');
    try { const { data } = await api.post('/auth/send-verification-otp', { email }); setNotice(data.message); }
    catch (failure) { setError(errorText(failure)); }
  };
  const verify = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/auth/verify-email', { email, otp });
      if (data.needsPassword) { setInvitationToken(data.invitationToken); setStep('password'); }
      else { setStep('done'); }
    } catch (failure) { setError(errorText(failure)); setOtp(''); } finally { setBusy(false); }
  };
  const activate = async () => {
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true); setError('');
    try { await api.post('/auth/accept-invite', { invitationToken, password }); setStep('done'); }
    catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  };

  if (step === 'done') return <AuthShell title="Your account is ready" subtitle="You can sign in with your new password.">
    <ShieldCheck className="mx-auto my-4 text-emerald-600" size={40} />
    <button className="primary-button w-full" onClick={() => navigate('/login')}>Go to sign in</button>
  </AuthShell>;

  if (step === 'password') return <AuthShell title="Choose your password" subtitle="This is the last step of your invitation.">
    {error && <div className="error-box">{error}</div>}
    <label className="field-label">Password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
    <PasswordStrength value={password} />
    <label className="field-label">Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
    <button className="primary-button mt-6 w-full" disabled={busy} onClick={activate}>{busy && <Loader2 className="animate-spin" size={17} />}Activate my account</button>
  </AuthShell>;

  return <AuthShell title="Verify your email" subtitle="Enter the 6-digit code from your invitation email." back="/login">
    {notice && <div className="info-box">{notice}</div>}
    {error && <div className="error-box">{error}</div>}
    <label className="field-label">Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
    <div className="mt-4"><OtpInput value={otp} onChange={setOtp} disabled={busy} /></div>
    <button className="primary-button mt-5 w-full" disabled={busy || otp.length !== 6 || !email} onClick={verify}>{busy && <Loader2 className="animate-spin" size={17} />}Verify email</button>
    <ResendButton onResend={resend} />
  </AuthShell>;
}

export { OtpInput, PasswordStrength };
