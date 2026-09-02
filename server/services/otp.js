const OtpRequest = require('../models/OtpRequest');
const { sha256, randomOtp } = require('./tokens');

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS || 45);
const OTP_MAX_PER_WINDOW = Number(process.env.OTP_MAX_PER_WINDOW || 5);
const OTP_WINDOW_MINUTES = 15;

/**
 * Issue a code for one email + purpose. Any earlier unused code for the same
 * pair is invalidated so only the newest code can ever be redeemed.
 * Returns { otp } - the plain code exists only long enough to be emailed.
 *
 * `force` skips the self-service throttle. It is only for administrator
 * actions, which are already permission-checked and audited; a colleague
 * waiting on a reset should never be blocked by someone else's cooldown.
 */
async function issueOtp({ user, email, purpose, ip, pendingEmail, force = false }) {
  const address = String(email).toLowerCase();
  const now = new Date();

  const recent = force ? null : await OtpRequest.findOne({ email: address, purpose }).sort({ createdAt: -1 });
  if (recent && now - recent.createdAt < OTP_RESEND_SECONDS * 1000) {
    const wait = Math.ceil((OTP_RESEND_SECONDS * 1000 - (now - recent.createdAt)) / 1000);
    return { error: `Please wait ${wait} seconds before requesting another code.`, retryAfter: wait };
  }
  const windowStart = new Date(now.getTime() - OTP_WINDOW_MINUTES * 60000);
  const issuedInWindow = force ? 0 : await OtpRequest.countDocuments({ email: address, purpose, createdAt: { $gte: windowStart } });
  if (issuedInWindow >= OTP_MAX_PER_WINDOW) {
    return { error: 'Too many codes requested. Please try again later.', retryAfter: OTP_WINDOW_MINUTES * 60 };
  }

  await OtpRequest.updateMany({ email: address, purpose, usedAt: null }, { usedAt: now, attempts: OTP_MAX_ATTEMPTS });
  const otp = randomOtp();
  await OtpRequest.create({
    userId: user?._id, companyId: user?.companyId, email: address, purpose,
    otpHash: sha256(`${address}:${purpose}:${otp}`),
    pendingEmail,
    expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60000),
    maxAttempts: OTP_MAX_ATTEMPTS, ipAddress: ip,
  });
  return { otp, expiresInMinutes: OTP_TTL_MINUTES };
}

/**
 * Check a submitted code. A wrong code burns an attempt; running out of
 * attempts invalidates the code entirely and forces a resend.
 */
async function verifyOtp({ email, purpose, otp }) {
  const address = String(email).toLowerCase();
  const record = await OtpRequest.findOne({ email: address, purpose, usedAt: null }).sort({ createdAt: -1 });
  if (!record) return { ok: false, error: 'That code is not valid. Request a new one.' };
  if (record.expiresAt < new Date()) return { ok: false, error: 'That code has expired. Request a new one.' };
  if (record.attempts >= record.maxAttempts) {
    record.usedAt = new Date();
    await record.save();
    return { ok: false, error: 'Too many incorrect attempts. Request a new code.' };
  }
  if (record.otpHash !== sha256(`${address}:${purpose}:${String(otp).trim()}`)) {
    record.attempts += 1;
    await record.save();
    const remaining = Math.max(0, record.maxAttempts - record.attempts);
    return { ok: false, attemptsRemaining: remaining, error: remaining ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` : 'Too many incorrect attempts. Request a new code.' };
  }
  record.usedAt = new Date();
  await record.save();
  return { ok: true, record };
}

// p*****@company.com
function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  if (!domain) return 'your email';
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(3, name.length - 1))}@${domain}`;
}

module.exports = { issueOtp, verifyOtp, maskEmail, OTP_TTL_MINUTES, OTP_MAX_ATTEMPTS, OTP_RESEND_SECONDS };
