const Session = require('../models/Session');
const { hashPassword, comparePassword } = require('./tokens');
const { issueOtp, verifyOtp, maskEmail, OTP_RESEND_SECONDS } = require('./otp');
const { sendEmail } = require('./email');
const { hasPermission } = require('../config/permissions');

// True when the password matches the current one or any of the recent hashes
// kept on the account. Only hashes are ever stored or compared.
async function isReusedPassword(user, password) {
  const candidates = [user.passwordHash, ...(user.passwordHistory || [])].filter(Boolean);
  for (const hash of candidates) if (await comparePassword(password, hash)) return true;
  return false;
}

/**
 * Sets a new password and ends every other session. `keepSessionId` lets the
 * caller stay signed in on the device that made the change. `user` must be
 * loaded with +passwordHash +passwordHistory.
 */
async function applyNewPassword(user, password, { keepSessionId = null, reason = 'password_changed' } = {}) {
  const keep = keepSessionId ? await Session.findById(keepSessionId) : null;
  user.passwordHash = await hashPassword(password);
  user.passwordHistory = [...(user.passwordHistory || []), user.passwordHash].slice(-5);
  user.passwordChangedAt = new Date();
  user.sessionsValidFrom = keep ? new Date(new Date(keep.createdAt).getTime() - 1000) : new Date();
  user.failedLoginCount = 0;
  user.lockedUntil = undefined;
  if (user.status === 'invited') { user.status = 'active'; user.emailVerified = true; user.activatedAt = new Date(); }
  await user.save();
  const scope = { userId: user._id, revokedAt: null };
  if (keep) scope._id = { $ne: keep._id };
  const result = await Session.updateMany(scope, { revokedAt: new Date(), revokedReason: reason });
  return result.modifiedCount;
}

// Accounts that can manage users (Admin and Super Admin among the built-in
// roles) confirm every password change with a code from their own mailbox,
// on top of their password. A stolen admin password alone then cannot be
// used to lock the owner out or take over someone else's account.
const needsChangeCode = actor => hasPermission(actor, 'users.edit');

/**
 * The emailed-code gate for a password change made by `req.user`. Call it
 * after every other check has passed. Without `otp` it mails a code and
 * answers { otpRequired }; with one it checks the code. Returns true when it
 * has already sent the response, false when the change may go ahead.
 */
async function passwordChangeCode(req, res, { purpose, otp, forWhom }) {
  const actor = req.user;
  if (!otp) {
    const issued = await issueOtp({ user: actor, email: actor.email, purpose, ip: req.ip });
    if (issued.error) { res.status(429).json({ error: issued.error, retryAfter: issued.retryAfter }); return true; }
    try {
      await sendEmail({ to: actor.email, template: 'password_change_otp', variables: { firstName: actor.firstName, otp: issued.otp, expiresInMinutes: issued.expiresInMinutes, forWhom }, context: { companyId: actor.companyId, actorUserId: actor._id } });
    } catch (err) {
      console.error('[password] could not send the change code:', err.message);
      res.status(502).json({ error: 'The verification code could not be emailed. Check the mail settings and try again.' });
      return true;
    }
    res.json({ otpRequired: true, maskedEmail: maskEmail(actor.email), expiresInMinutes: issued.expiresInMinutes, resendAfterSeconds: OTP_RESEND_SECONDS });
    return true;
  }
  const result = await verifyOtp({ email: actor.email, purpose, otp });
  if (!result.ok) { res.status(400).json({ error: result.error, code: 'otp_invalid' }); return true; }
  return false;
}

module.exports = { isReusedPassword, applyNewPassword, needsChangeCode, passwordChangeCode };
