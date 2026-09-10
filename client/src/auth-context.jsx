import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { api, can, canAny, refreshSession, setAccessToken } from './api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const HEARTBEAT_MS = 3 * 60 * 1000;

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, company: null, workspace: null });
  const heartbeat = useRef(null);

  const signedOut = useCallback(() => { setAccessToken(null); setState({ status: 'anonymous', user: null, company: null, workspace: null }); }, []);

  const loadSession = useCallback(async () => {
    const { data } = await api.get('/auth/me');
    setState({ status: 'authenticated', user: data.user, company: data.company, workspace: data.workspace });
    return data.user;
  }, []);

  // A refresh cookie survives a reload, so the session is restored silently.
  useEffect(() => {
    let live = true;
    refreshSession()
      .then(() => (live ? loadSession() : null))
      .catch(() => (live ? signedOut() : null));
    return () => { live = false; };
  }, [loadSession, signedOut]);

  // Keeps "who is online" current without exposing anything private.
  useEffect(() => {
    if (state.status !== 'authenticated') return undefined;
    heartbeat.current = setInterval(() => { api.post('/auth/heartbeat').catch(() => {}); }, HEARTBEAT_MS);
    return () => clearInterval(heartbeat.current);
  }, [state.status]);

  const value = useMemo(() => ({
    ...state,
    // Step one: the password. A correct password does not sign anyone in - it
    // returns a challenge, and the caller then has to complete verifyLoginOtp.
    signIn: async credentials => {
      const { data } = await api.post('/auth/login', credentials);
      if (data.mfaRequired) return data;
      // Kept for the case where the server stops requiring a second factor.
      setAccessToken(data.accessToken);
      await loadSession();
      return { user: data.user };
    },
    // Step two: the emailed code, which is what actually opens the session.
    verifyLoginOtp: async payload => {
      const { data } = await api.post('/auth/login/verify-otp', payload);
      setAccessToken(data.accessToken);
      await loadSession();
      return data.user;
    },
    signOut: async () => { await api.post('/auth/logout').catch(() => {}); signedOut(); },
    reload: loadSession,
    can: permission => can(state.user, permission),
    canAny: permissions => canAny(state.user, permissions),
  }), [state, loadSession, signedOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Protected({ children, permission, anyOf }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <div className="loading"><Loader2 className="animate-spin" /></div>;
  if (auth.status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const allowed = (!permission || auth.can(permission)) && (!anyOf || auth.canAny(anyOf));
  if (!allowed) return <Forbidden />;
  return children;
}

export function Forbidden() {
  return <div className="grid min-h-[60vh] place-items-center p-6">
    <div className="card max-w-md text-center">
      <ShieldAlert className="mx-auto text-amber-500" size={40} />
      <h1 className="mt-4 text-xl font-semibold">You do not have access to this page</h1>
      <p className="mt-2 text-sm text-slate-500">Your role does not include this permission. Ask an administrator if you need it.</p>
      <a className="secondary-button mt-5 inline-flex" href="/">Back to documents</a>
    </div>
  </div>;
}
