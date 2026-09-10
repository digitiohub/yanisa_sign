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
let warnedAboutFallback = false;

/**
 * The master key the per-code secrets are derived from.
 *
 * OTP_SECRET is preferred, but falling back to a value derived from
 * JWT_SECRET matters more than the purity: this key sits on the sign-in path,
 * so treating it as mandatory means any deployment that has not added the
 * variable yet cannot log anyone in at all. Derived rather than used directly,
 * so the session signing key is never also the OTP key.
 */
function otpMasterKey() {
  if (process.env.OTP_SECRET) return process.env.OTP_SECRET;
  if (!process.env.JWT_SECRET) throw new Error('Set OTP_SECRET (or JWT_SECRET) before issuing sign-in codes.');
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn('[otp] OTP_SECRET is not set - deriving the code key from JWT_SECRET. Set OTP_SECRET so rotating JWT_SECRET does not invalidate codes in flight.');
  }
  return crypto.createHash('sha256').update(`yanisa-otp-v1:${process.env.JWT_SECRET}`).digest();
}

function deriveSecret(email) {
  const nonce = crypto.randomBytes(16).toString('hex');
  return crypto.createHmac('sha256', otpMasterKey()).update(`${normaliseEmail(email)}:${nonce}`).digest('hex');
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
