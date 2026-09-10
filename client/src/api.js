import axios from 'axios';

// The access token is short lived and kept in memory only. The refresh token
// lives in an HttpOnly cookie the browser sends on /api/auth calls, so a
// stolen localStorage entry cannot be replayed as a session.
let accessToken = null;
const listeners = new Set();

export const getAccessToken = () => accessToken;
export const setAccessToken = token => { accessToken = token; listeners.forEach(listener => listener(token)); };
export const onTokenChange = listener => { listeners.add(listener); return () => listeners.delete(listener); };

export const api = axios.create({ baseURL: '/api', withCredentials: true });
api.interceptors.request.use(config => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// One shared refresh: parallel 401s wait for the same call instead of racing.
let refreshing = null;
export function refreshSession() {
  if (!refreshing) {
    refreshing = api.post('/auth/refresh')
      .then(({ data }) => { setAccessToken(data.accessToken); return data; })
      .catch(error => { setAccessToken(null); throw error; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

api.interceptors.response.use(response => response, async error => {
  const request = error.config;
  // /auth/login and /auth/login/verify-otp both 401 on bad credentials; a
  // refresh-and-retry there would mask the real error.
  const isAuthCall = request?.url?.startsWith('/auth/refresh') || request?.url?.startsWith('/auth/login');
  if (error.response?.status === 401 && request && !request.__retried && !isAuthCall) {
    request.__retried = true;
    try { await refreshSession(); return api(request); }
    catch { setAccessToken(null); }
  }
  return Promise.reject(error);
});

export const errorText = error => error?.response?.data?.error || error?.message || 'Something went wrong. Please try again.';

// Mirrors hasPermission on the server. The UI hides what a user cannot do;
// the API is what actually enforces it.
export function can(user, permission) {
  const granted = user?.permissions || [];
  if (!permission) return true;
  if (granted.includes('*') || granted.includes(permission)) return true;
  return granted.includes(`${String(permission).split('.')[0]}.*`);
}
export const canAny = (user, permissions = []) => permissions.some(permission => can(user, permission));

export const fullName = user => (user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : '');
export const initials = user => (user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || user.email?.[0]?.toUpperCase() : '?');

export const formatDateTime = value => (value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const formatDate = value => (value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
export function timeAgo(value) {
  if (!value) return 'never';
  const seconds = Math.round((Date.now() - new Date(value)) / 1000);
  if (seconds < 60) return 'just now';
  const units = [['minute', 60], ['hour', 60], ['day', 24], ['month', 30], ['year', 12]];
  let amount = Math.round(seconds / 60), index = 0;
  while (index < units.length - 1 && amount >= units[index + 1][1]) { amount = Math.round(amount / units[index + 1][1]); index += 1; }
  return `${amount} ${units[index][0]}${amount === 1 ? '' : 's'} ago`;
}
