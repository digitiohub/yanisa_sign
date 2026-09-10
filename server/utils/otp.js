const crypto = require('crypto');
const { generate, verify } = require('otplib');

// Five minutes, expressed once. OTP_LOGIN_TTL_MINUTES lets an operator shorten
// it without touching code; it is deliberately separate from OTP_TTL_MINUTES,
// which governs the older password-reset and email-verification codes.
const OTP_TTL_MINUTES = Number(process.env.OTP_LOGIN_TTL_MINUTES || 5);
const OTP_TTL_SECONDS = OTP_TTL_MINUTES * 60;
const OTP_DIGITS = 6;

const normaliseEmail = email => String(email || '').trim().toLowerCase();

/**
 * Derive the TOTP secret for one code.
 *
 * HMAC-SHA256 keyed by OTP_SECRET, over the address plus a random nonce:
 *
 *   - keying by OTP_SECRET means the master key never leaves the environment,
 *     so a dump of the otpsecrets collection is not enough to mint codes;
 *   - binding the address in stops a secret captured for one user from being
 *     replayed against another;
 *   - the nonce rotates the secret on every request, so asking for a new code
 *     immediately invalidates the previous one even within the same time step.
 */
function deriveSecret(email) {
  const key = process.env.OTP_SECRET;
  if (!key) throw new Error('OTP_SECRET is not set');
  const nonce = crypto.randomBytes(16).toString('hex');
  return crypto.createHmac('sha256', key).update(`${normaliseEmail(email)}:${nonce}`).digest('hex');
}

/**
 * TOTP parameters for one stored secret.
 *
 * `period` is the full five minutes and `t0` is pinned to the moment the code
 * was issued. Anchoring the time step to issue time is what makes the code
 * last a true five minutes: with the usual t0 of 0, a code handed out near a
 * step boundary would expire a few seconds later, and widening the accepted
 * window to compensate would let codes live for up to ten minutes instead.
 */
const paramsFor = (secretHex, issuedAt) => ({
  // The secret is raw HMAC bytes, not a Base32 string, so it is passed as a
  // Buffer - otplib treats plain strings as Base32.
  secret: Buffer.from(secretHex, 'hex'),
  digits: OTP_DIGITS,
  period: OTP_TTL_SECONDS,
  t0: Math.floor(new Date(issuedAt).getTime() / 1000),
});

/** The six-digit code for a freshly derived secret. */
const generateOtp = (secretHex, issuedAt) => generate(paramsFor(secretHex, issuedAt));

/**
 * Constant-time check of a submitted code (otplib compares digests, not
 * strings, so a wrong code cannot be narrowed down by timing).
 */
async function verifyOtp(secretHex, token, issuedAt) {
  if (!/^\d{6}$/.test(String(token || '').trim())) return false;
  const result = await verify({ ...paramsFor(secretHex, issuedAt), token: String(token).trim() });
  return Boolean(result && result.valid);
}

/** Issue time recovered from the stored expiry, so the model needs no extra field. */
const issuedAtFrom = expiresAt => new Date(new Date(expiresAt).getTime() - OTP_TTL_SECONDS * 1000);

/** p*****@company.com - shown back to the user without leaking the address. */
function maskEmail(email) {
  const [name, domain] = normaliseEmail(email).split('@');
  if (!domain) return 'your email';
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(3, name.length - 1))}@${domain}`;
}

module.exports = {
  deriveSecret, generateOtp, verifyOtp, issuedAtFrom, normaliseEmail, maskEmail,
  OTP_TTL_MINUTES, OTP_TTL_SECONDS, OTP_DIGITS,
};
