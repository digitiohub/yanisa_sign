const express = require('express');
const rateLimit = require('express-rate-limit');
const { UAParser } = require('ua-parser-js');
const { z } = require('zod');

const User = require('../models/User');
const Role = require('../models/Role');
const Company = require('../models/Company');
const Workspace = require('../models/Workspace');
const Session = require('../models/Session');
const ActionToken = require('../models/ActionToken');
const LoginAttempt = require('../models/LoginAttempt');
const ActivityLog = require('../models/ActivityLog');
const { authenticate } = require('../middleware/auth');
const { logAuditEvent } = require('../services/audit');
const { issueOtp, verifyOtp, maskEmail, OTP_TTL_MINUTES, OTP_RESEND_SECONDS } = require('../services/otp');
const { sendEmail } = require('../services/email');
const {
  sha256, randomToken, signAccessToken, setRefreshCookie, clearRefreshCookie,
  hashPassword, comparePassword, passwordProblem, REFRESH_TOKEN_DAYS, REFRESH_COOKIE, ACCESS_TOKEN_TTL,
} = require('../services/tokens');

const router = express.Router();

const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS || 5);
const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);
const RESET_TOKEN_MINUTES = 15;
const GENERIC_OTP_REPLY = 'If an account exists for this email, a verification code has been sent.';

// Per-IP throttles. They sit in front of the per-account lockout, which is the
// real defence; keep them loose enough that a shared office address is not
// locked out by a colleague's typo.
const limiter = (max, minutes = 15) => rateLimit({ windowMs: minutes * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please try again later.' } });
const loginLimiter = limiter(Number(process.env.RATE_LIMIT_LOGIN || 200));
const otpSendLimiter = limiter(Number(process.env.RATE_LIMIT_OTP_SEND || 15));
const otpVerifyLimiter = limiter(Number(process.env.RATE_LIMIT_OTP_VERIFY || 40));

const validate = schema => (req, res, next) => {
  const result = schema.safeParse(req.body || {});
  if (!result.success) return res.status(400).json({ error: result.error.issues[0]?.message || 'Invalid request' });
  req.body = result.data;
  return next();
};
const emailField = z.string().trim().toLowerCase().email('Enter a valid email address.');
const otpField = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.');
const passwordField = z.string().min(1, 'Password is required.');

function deviceOf(req) {
  const parsed = new UAParser(req.get('user-agent') || '').getResult();
  return {
    userAgent: req.get('user-agent'),
    browser: [parsed.browser.name, parsed.browser.version?.split('.')[0]].filter(Boolean).join(' ') || 'Unknown browser',
    os: [parsed.os.name, parsed.os.version].filter(Boolean).join(' ') || 'Unknown OS',
    device: parsed.device.type ? `${parsed.device.vendor || ''} ${parsed.device.model || parsed.device.type}`.trim() : 'Desktop',
  };
}

async function publicUser(user) {
  const role = await Role.findById(user.roleId).lean();
  return {
    id: user._id, companyId: user.companyId, workspaceId: user.workspaceId,
    firstName: user.firstName, lastName: user.lastName, fullName: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email, phone: user.phone, status: user.status, emailVerified: user.emailVerified,
    role: role ? { id: role._id, key: role.key, name: role.name, rank: role.rank } : null,
    permissions: role?.permissions || [],
    lastLoginAt: user.lastLoginAt, createdAt: user.createdAt,
  };
}

async function startSession(req, res, user, { rememberMe = true } = {}) {
  const refreshToken = randomToken();
  const days = rememberMe ? REFRESH_TOKEN_DAYS : 1;
  const session = await Session.create({
    userId: user._id, companyId: user.companyId,
    refreshTokenHash: sha256(refreshToken),
    ipAddress: req.ip, ...deviceOf(req),
    expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  });
  setRefreshCookie(res, refreshToken, { rememberMe });
  const role = await Role.findById(user.roleId).lean();
  return { session, accessToken: signAccessToken({ userId: user._id, companyId: user.companyId, sessionId: session._id, roleKey: role?.key }) };
}

const recordAttempt = (req, { email, userId, companyId, success, reason }) =>
  LoginAttempt.create({ email, userId, companyId, success, reason, ipAddress: req.ip, userAgent: req.get('user-agent') }).catch(() => {});

// ---------------------------------------------------------------- login

router.post('/login', loginLimiter, validate(z.object({ email: emailField, password: passwordField, rememberMe: z.boolean().optional() })), async (req, res, next) => {
  const { email, password, rememberMe = true } = req.body;
  try {
    const user = await User.findOne({ email, deletedAt: null }).select('+passwordHash');
    const invalid = () => res.status(401).json({ error: 'Invalid email or password.' });

    if (!user) { await recordAttempt(req, { email, success: false, reason: 'unknown_account' }); return invalid(); }
    // An invited account has no password yet, so send them to the invitation
    // instead of burning login attempts against a hash that does not exist.
    if (user.status === 'invited' && !user.passwordHash) {
      await recordAttempt(req, { email, userId: user._id, companyId: user.companyId, success: false, reason: 'invitation_pending' });
      return res.status(403).json({ error: 'Finish setting up your account from the invitation email before signing in.', code: 'invitation_pending' });
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await recordAttempt(req, { email, userId: user._id, companyId: user.companyId, success: false, reason: 'locked' });
      const minutes = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
    }
    if (!(await comparePassword(password, user.passwordHash))) {
      user.failedLoginCount = (user.failedLoginCount || 0) + 1;
      if (user.failedLoginCount >= MAX_FAILED_LOGINS) user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      await user.save();
      await recordAttempt(req, { email, userId: user._id, companyId: user.companyId, success: false, reason: 'bad_password' });
      await logAuditEvent({ req, actor: user, companyId: user.companyId, action: 'authentication.login_failed', entityType: 'authentication', entityId: user._id, description: `Failed sign-in for ${user.email}`, metadata: { attempt: user.failedLoginCount, locked: Boolean(user.lockedUntil && user.lockedUntil > new Date()) } });
      return invalid();
    }
    if (user.status !== 'active') {
      await recordAttempt(req, { email, userId: user._id, companyId: user.companyId, success: false, reason: `status_${user.status}` });
      return res.status(403).json({ error: 'This account is not active. Contact your administrator.' });
    }

    user.failedLoginCount = 0; user.lockedUntil = undefined;
    user.lastLoginAt = new Date(); user.lastLoginIp = req.ip; user.lastActivityAt = new Date();
    await user.save();

    const { accessToken, session } = await startSession(req, res, user, { rememberMe });
    await recordAttempt(req, { email, userId: user._id, companyId: user.companyId, success: true });
    await logAuditEvent({ req, actor: user, action: 'authentication.login', entityType: 'authentication', entityId: user._id, description: `${user.firstName} signed in`, metadata: { sessionId: String(session._id), browser: session.browser, os: session.os } });
    return res.json({ accessToken, expiresIn: ACCESS_TOKEN_TTL, user: await publicUser(user) });
  } catch (err) { return next(err); }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    const session = await Session.findOne({ refreshTokenHash: sha256(token) });
    if (!session || session.revokedAt || session.expiresAt < new Date()) { clearRefreshCookie(res); return res.status(401).json({ error: 'This session has ended. Please sign in again.' }); }

    const user = await User.findOne({ _id: session.userId, deletedAt: null });
    if (!user || user.status !== 'active' || (user.sessionsValidFrom && session.createdAt < user.sessionsValidFrom)) {
      session.revokedAt = new Date(); session.revokedReason = 'account_unavailable'; await session.save();
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'This session has ended. Please sign in again.' });
    }

    // Rotate: the presented token is replaced on every refresh.
    const nextToken = randomToken();
    session.refreshTokenHash = sha256(nextToken);
    session.lastActivityAt = new Date();
    session.ipAddress = req.ip;
    await session.save();
    setRefreshCookie(res, nextToken);
    const role = await Role.findById(user.roleId).lean();
    return res.json({ accessToken: signAccessToken({ userId: user._id, companyId: user.companyId, sessionId: session._id, roleKey: role?.key }), expiresIn: ACCESS_TOKEN_TTL, user: await publicUser(user) });
  } catch (err) { return next(err); }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      const session = await Session.findOne({ refreshTokenHash: sha256(token) });
      if (session && !session.revokedAt) {
        session.revokedAt = new Date(); session.revokedReason = 'signed_out'; await session.save();
        const user = await User.findById(session.userId).lean();
        if (user) await logAuditEvent({ req, actor: user, action: 'authentication.logout', entityType: 'authentication', entityId: user._id, description: `${user.firstName} signed out` });
      }
    }
    clearRefreshCookie(res);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const [company, workspace] = await Promise.all([
      Company.findById(req.user.companyId).lean(),
      req.user.workspaceId ? Workspace.findById(req.user.workspaceId).lean() : null,
    ]);
    return res.json({
      user: await publicUser(req.user),
      company: company ? { id: company._id, name: company.name, slug: company.slug } : null,
      workspace: workspace ? { id: workspace._id, name: workspace.name } : null,
    });
  } catch (err) { return next(err); }
});

// Keeps "who is online" fresh without polling anything heavier.
router.post('/heartbeat', authenticate, (req, res) => res.json({ ok: true, at: new Date() }));

// ------------------------------------------------------- password reset

router.post('/forgot-password', otpSendLimiter, validate(z.object({ email: emailField })), async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email, deletedAt: null });
    // Always the same reply: never reveal whether the address is registered.
    if (!user || !['active', 'invited'].includes(user.status)) return res.json({ message: GENERIC_OTP_REPLY, maskedEmail: maskEmail(req.body.email), expiresInMinutes: OTP_TTL_MINUTES, resendAfterSeconds: OTP_RESEND_SECONDS });

    const issued = await issueOtp({ user, email: user.email, purpose: 'password_reset', ip: req.ip });
    if (issued.error) return res.json({ message: GENERIC_OTP_REPLY, maskedEmail: maskEmail(user.email), expiresInMinutes: OTP_TTL_MINUTES, resendAfterSeconds: OTP_RESEND_SECONDS });
    await sendEmail({ to: user.email, template: 'password_reset_otp', variables: { firstName: user.firstName, otp: issued.otp, expiresInMinutes: issued.expiresInMinutes } });
    await logAuditEvent({ req, actor: user, action: 'authentication.password_reset_requested', entityType: 'authentication', entityId: user._id, description: `Password reset code sent to ${maskEmail(user.email)}` });
    return res.json({ message: GENERIC_OTP_REPLY, maskedEmail: maskEmail(user.email), expiresInMinutes: OTP_TTL_MINUTES, resendAfterSeconds: OTP_RESEND_SECONDS });
  } catch (err) { return next(err); }
});

router.post('/verify-reset-otp', otpVerifyLimiter, validate(z.object({ email: emailField, otp: otpField })), async (req, res, next) => {
  try {
    const result = await verifyOtp({ email: req.body.email, purpose: 'password_reset', otp: req.body.otp });
    if (!result.ok) return res.status(400).json({ error: result.error, attemptsRemaining: result.attemptsRemaining });
    const user = await User.findOne({ email: req.body.email, deletedAt: null });
    if (!user) return res.status(400).json({ error: 'That code is not valid. Request a new one.' });

    // The OTP is spent here; a short-lived single-use token carries the reset.
    const token = randomToken();
    await ActionToken.create({ userId: user._id, companyId: user.companyId, purpose: 'password_reset', tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60000), createdByIp: req.ip });
    return res.json({ resetToken: token, expiresInMinutes: RESET_TOKEN_MINUTES });
  } catch (err) { return next(err); }
});

/**
 * Sets a new password and ends every other session. `keepSessionId` lets the
 * caller stay signed in on the device that made the change.
 */
// True when the password matches the current one or any of the recent hashes
// kept on the account. Only hashes are ever stored or compared.
async function isReusedPassword(user, password) {
  const candidates = [user.passwordHash, ...(user.passwordHistory || [])].filter(Boolean);
  for (const hash of candidates) if (await comparePassword(password, hash)) return true;
  return false;
}

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

router.post('/reset-password', validate(z.object({ resetToken: z.string().min(10), password: z.string() })), async (req, res, next) => {
  try {
    const problem = passwordProblem(req.body.password);
    if (problem) return res.status(400).json({ error: problem });
    const record = await ActionToken.findOne({ tokenHash: sha256(req.body.resetToken), purpose: 'password_reset', usedAt: null });
    if (!record || record.expiresAt < new Date()) return res.status(400).json({ error: 'This reset link has expired. Start again.' });
    const user = await User.findById(record.userId).select('+passwordHash +passwordHistory');
    if (!user || user.deletedAt) return res.status(400).json({ error: 'This reset link is no longer valid.' });
    if (await isReusedPassword(user, req.body.password)) return res.status(400).json({ error: 'Choose a password you have not used before.' });

    await applyNewPassword(user, req.body.password, { reason: 'password_reset' });
    record.usedAt = new Date(); await record.save();
    clearRefreshCookie(res);
    await sendEmail({ to: user.email, template: 'password_changed', variables: { firstName: user.firstName, changedAt: new Date().toUTCString() } }).catch(() => {});
    await logAuditEvent({ req, actor: user, action: 'authentication.password_reset', entityType: 'authentication', entityId: user._id, description: `${user.firstName} reset their password`, metadata: { sessionsRevoked: true } });
    return res.json({ ok: true, message: 'Password updated. Sign in with your new password.' });
  } catch (err) { return next(err); }
});

// -------------------------------------------------- invitation / verify

router.post('/send-verification-otp', otpSendLimiter, validate(z.object({ email: emailField })), async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email, deletedAt: null });
    const reply = { message: GENERIC_OTP_REPLY, maskedEmail: maskEmail(req.body.email), expiresInMinutes: OTP_TTL_MINUTES, resendAfterSeconds: OTP_RESEND_SECONDS };
    if (!user || user.emailVerified && user.status !== 'invited') return res.json(reply);

    const issued = await issueOtp({ user, email: user.email, purpose: 'email_verification', ip: req.ip });
    if (issued.error) return res.json(reply);
    await sendEmail({ to: user.email, template: 'email_verification_otp', variables: { firstName: user.firstName, otp: issued.otp, expiresInMinutes: issued.expiresInMinutes } });
    return res.json(reply);
  } catch (err) { return next(err); }
});

// Confirms the address and hands back a single-use token to set the password.
router.post('/verify-email', otpVerifyLimiter, validate(z.object({ email: emailField, otp: otpField })), async (req, res, next) => {
  try {
    const result = await verifyOtp({ email: req.body.email, purpose: 'email_verification', otp: req.body.otp });
    if (!result.ok) return res.status(400).json({ error: result.error, attemptsRemaining: result.attemptsRemaining });
    const user = await User.findOne({ email: req.body.email, deletedAt: null }).select('+passwordHash');
    if (!user) return res.status(400).json({ error: 'That code is not valid. Request a new one.' });

    user.emailVerified = true;
    await user.save();
    await logAuditEvent({ req, actor: user, action: 'user.email_verified', entityType: 'user', entityId: user._id, description: `${user.email} verified their email address` });

    if (user.status === 'invited' || !user.passwordHash) {
      const token = randomToken();
      await ActionToken.create({ userId: user._id, companyId: user.companyId, purpose: 'invitation', tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60000), createdByIp: req.ip });
      return res.json({ ok: true, needsPassword: true, invitationToken: token });
    }
    return res.json({ ok: true, needsPassword: false });
  } catch (err) { return next(err); }
});

router.post('/accept-invite', validate(z.object({ invitationToken: z.string().min(10), password: z.string() })), async (req, res, next) => {
  try {
    const problem = passwordProblem(req.body.password);
    if (problem) return res.status(400).json({ error: problem });
    const record = await ActionToken.findOne({ tokenHash: sha256(req.body.invitationToken), purpose: 'invitation', usedAt: null });
    if (!record || record.expiresAt < new Date()) return res.status(400).json({ error: 'This invitation has expired. Ask your administrator to resend it.' });
    const user = await User.findById(record.userId).select('+passwordHash +passwordHistory');
    if (!user || user.deletedAt) return res.status(400).json({ error: 'This invitation is no longer valid.' });

    await applyNewPassword(user, req.body.password, { reason: 'invitation_accepted' });
    record.usedAt = new Date(); await record.save();
    const company = await Company.findById(user.companyId).lean();
    await sendEmail({ to: user.email, template: 'account_activated', variables: { firstName: user.firstName, companyName: company?.name || 'Yanisa' } }).catch(() => {});
    await logAuditEvent({ req, actor: user, action: 'user.activated', entityType: 'user', entityId: user._id, description: `${user.email} completed their invitation and activated the account` });
    return res.json({ ok: true, message: 'Your account is ready. Sign in to continue.' });
  } catch (err) { return next(err); }
});

// -------------------------------------------------------------- account

router.post('/change-password', authenticate, validate(z.object({ currentPassword: passwordField, newPassword: z.string(), logoutOtherSessions: z.boolean().optional() })), async (req, res, next) => {
  try {
    const problem = passwordProblem(req.body.newPassword);
    if (problem) return res.status(400).json({ error: problem });
    const user = await User.findById(req.user._id).select('+passwordHash +passwordHistory');
    if (!(await comparePassword(req.body.currentPassword, user.passwordHash))) return res.status(400).json({ error: 'Your current password is incorrect.' });
    if (await isReusedPassword(user, req.body.newPassword)) return res.status(400).json({ error: 'Choose a password you have not used before.' });

    const revoked = await applyNewPassword(user, req.body.newPassword, { keepSessionId: req.user.sessionId });
    await sendEmail({ to: user.email, template: 'password_changed', variables: { firstName: user.firstName, changedAt: new Date().toUTCString() } }).catch(() => {});
    await logAuditEvent({ req, action: 'authentication.password_changed', entityType: 'authentication', entityId: user._id, description: `${req.user.fullName} changed their password`, metadata: { otherSessionsRevoked: revoked } });
    return res.json({ ok: true, signedOutElsewhere: revoked });
  } catch (err) { return next(err); }
});

// Self-service profile edits. Changing your own name needs no admin rights;
// role, status and team stay under users.edit in the admin API.
router.patch('/profile', authenticate, validate(z.object({
  firstName: z.string().trim().min(1, 'First name is required.').optional(),
  lastName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
})), async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    const before = { firstName: user.firstName, lastName: user.lastName, phone: user.phone };
    for (const field of ['firstName', 'lastName', 'phone']) if (req.body[field] !== undefined) user[field] = req.body[field];
    user.updatedBy = req.user._id;
    await user.save();
    await logAuditEvent({ req, action: 'user.profile_updated', entityType: 'user', entityId: user._id, entityLabel: user.email, description: `${req.user.fullName} updated their profile`, before, after: { firstName: user.firstName, lastName: user.lastName, phone: user.phone } });
    return res.json(await publicUser(user));
  } catch (err) { return next(err); }
});

router.post('/email-change/request', authenticate, otpSendLimiter, validate(z.object({ email: emailField, password: passwordField })), async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!(await comparePassword(req.body.password, user.passwordHash))) return res.status(400).json({ error: 'Your password is incorrect.' });
    if (req.body.email === user.email) return res.status(400).json({ error: 'That is already your email address.' });
    const taken = await User.findOne({ companyId: user.companyId, email: req.body.email, deletedAt: null });
    if (taken) return res.status(409).json({ error: 'That email address is already in use.' });

    const issued = await issueOtp({ user, email: req.body.email, purpose: 'email_change', ip: req.ip, pendingEmail: req.body.email });
    if (issued.error) return res.status(429).json({ error: issued.error, retryAfter: issued.retryAfter });
    await sendEmail({ to: req.body.email, template: 'email_change_otp', variables: { firstName: user.firstName, otp: issued.otp, pendingEmail: req.body.email, expiresInMinutes: issued.expiresInMinutes } });
    return res.json({ ok: true, maskedEmail: maskEmail(req.body.email), expiresInMinutes: OTP_TTL_MINUTES });
  } catch (err) { return next(err); }
});

router.post('/email-change/verify', authenticate, otpVerifyLimiter, validate(z.object({ email: emailField, otp: otpField })), async (req, res, next) => {
  try {
    const result = await verifyOtp({ email: req.body.email, purpose: 'email_change', otp: req.body.otp });
    if (!result.ok) return res.status(400).json({ error: result.error, attemptsRemaining: result.attemptsRemaining });
    const user = await User.findById(req.user._id);
    const previousEmail = user.email;
    user.email = req.body.email;
    user.emailVerified = true;
    await user.save();
    // Tell the old address, then require a fresh sign-in everywhere.
    await sendEmail({ to: previousEmail, template: 'email_changed_notice', variables: { firstName: user.firstName, newEmail: user.email } }).catch(() => {});
    await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokedReason: 'email_changed' });
    await User.updateOne({ _id: user._id }, { sessionsValidFrom: new Date() });
    clearRefreshCookie(res);
    await logAuditEvent({ req, action: 'user.email_changed', entityType: 'user', entityId: user._id, description: `${previousEmail} changed their email address`, before: { email: previousEmail }, after: { email: user.email } });
    return res.json({ ok: true, message: 'Email updated. Sign in again with your new address.' });
  } catch (err) { return next(err); }
});

// ------------------------------------------------------------- sessions

router.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const sessions = await Session.find({ userId: req.user._id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastActivityAt: -1 }).lean();
    return res.json(sessions.map(session => ({
      id: session._id, browser: session.browser, os: session.os, device: session.device,
      ipAddress: session.ipAddress, createdAt: session.createdAt, lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt, current: String(session._id) === String(req.user.sessionId),
    })));
  } catch (err) { return next(err); }
});

router.delete('/sessions/:id', authenticate, async (req, res, next) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.revokedAt = new Date(); session.revokedBy = req.user._id; session.revokedReason = 'user_revoked';
    await session.save();
    await logAuditEvent({ req, action: 'session.revoked', entityType: 'session', entityId: session._id, description: `${req.user.fullName} signed out a ${session.browser} session`, metadata: { ipAddress: session.ipAddress } });
    if (String(session._id) === String(req.user.sessionId)) clearRefreshCookie(res);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

router.delete('/sessions', authenticate, async (req, res, next) => {
  try {
    const result = await Session.updateMany({ userId: req.user._id, revokedAt: null, _id: { $ne: req.user.sessionId } }, { revokedAt: new Date(), revokedBy: req.user._id, revokedReason: 'user_revoked_all' });
    await logAuditEvent({ req, action: 'session.revoked_all', entityType: 'session', entityId: req.user._id, description: `${req.user.fullName} signed out all other devices`, metadata: { count: result.modifiedCount } });
    return res.json({ ok: true, revoked: result.modifiedCount });
  } catch (err) { return next(err); }
});

// The signed-in user's own recent activity.
router.get('/activity', authenticate, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const events = await ActivityLog.find({ companyId: req.user.companyId, actorUserId: req.user._id }).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json(events);
  } catch (err) { return next(err); }
});

module.exports = router;
