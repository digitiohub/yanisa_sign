const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Short-lived access token in the Authorization header, long-lived refresh
// token in an HttpOnly cookie. The refresh token is opaque and only its hash
// is stored, so a database leak cannot be replayed as a session.
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '30m';
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 7);
const REFRESH_COOKIE = 'yanisa_refresh';

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
const randomOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const signAccessToken = ({ userId, companyId, sessionId, roleKey }) => jwt.sign(
  { sub: String(userId), cid: String(companyId), sid: String(sessionId), role: roleKey, typ: 'access' },
  process.env.JWT_SECRET,
  { expiresIn: ACCESS_TOKEN_TTL },
);

function verifyAccessToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.typ !== 'access') throw new Error('Wrong token type');
  return payload;
}

const refreshCookieOptions = ({ rememberMe = true } = {}) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/api/auth',
  // Without "remember me" the cookie lives only as long as the browser session.
  ...(rememberMe ? { maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000 } : {}),
});

const setRefreshCookie = (res, token, options) => res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(options));
const clearRefreshCookie = res => res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions({ rememberMe: false }) });

const hashPassword = password => bcrypt.hash(password, 12);
const comparePassword = (password, hash) => (hash ? bcrypt.compare(password, hash) : Promise.resolve(false));

// At least 8 characters with a mix of character classes.
function passwordProblem(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters long.';
  if (value.length > 128) return 'Password must be 128 characters or fewer.';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(value)).length;
  if (classes < 3) return 'Use at least three of: lowercase, uppercase, number, special character.';
  return null;
}

module.exports = {
  ACCESS_TOKEN_TTL, REFRESH_TOKEN_DAYS, REFRESH_COOKIE,
  sha256, randomToken, randomOtp,
  signAccessToken, verifyAccessToken,
  setRefreshCookie, clearRefreshCookie,
  hashPassword, comparePassword, passwordProblem,
};
