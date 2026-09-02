const User = require('../models/User');
const Role = require('../models/Role');
const Session = require('../models/Session');
const { verifyAccessToken } = require('../services/tokens');
const { hasPermission, hasAnyPermission } = require('../config/permissions');

const ACTIVITY_THROTTLE_MS = 60 * 1000;

/**
 * Verifies the access token, then re-checks the account and session against
 * the database on every request so a deactivation, role change or revoked
 * session takes effect immediately rather than at token expiry.
 */
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let payload;
  try { payload = verifyAccessToken(token); }
  catch { return res.status(401).json({ error: 'Invalid or expired session' }); }

  try {
    const user = await User.findOne({ _id: payload.sub, deletedAt: null }).lean();
    if (!user) return res.status(401).json({ error: 'Invalid or expired session' });
    if (user.status !== 'active') return res.status(403).json({ error: 'This account is not active. Contact your administrator.' });

    const session = await Session.findById(payload.sid).lean();
    if (!session || session.revokedAt || session.expiresAt < new Date()) return res.status(401).json({ error: 'This session has ended. Please sign in again.' });
    if (user.sessionsValidFrom && session.createdAt < user.sessionsValidFrom) return res.status(401).json({ error: 'This session has ended. Please sign in again.' });

    const role = await Role.findById(user.roleId).lean();
    req.user = {
      ...user,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      roleKey: role?.key,
      roleName: role?.name,
      roleRank: role?.rank || 0,
      permissions: role?.permissions || [],
      sessionId: session._id,
    };
    req.sessionRecord = session;

    const now = new Date();
    if (!user.lastActivityAt || now - new Date(user.lastActivityAt) > ACTIVITY_THROTTLE_MS) {
      await Promise.all([
        User.updateOne({ _id: user._id }, { lastActivityAt: now }),
        Session.updateOne({ _id: session._id }, { lastActivityAt: now }),
      ]).catch(() => {});
    }
    return next();
  } catch (err) { return next(err); }
}

/** Requires every listed permission. Backend is the authority, not the UI. */
const permit = (...permissions) => (req, res, next) => {
  const missing = permissions.filter(permission => !hasPermission(req.user, permission));
  if (missing.length) return res.status(403).json({ error: 'Insufficient permission', required: missing });
  return next();
};

/** Requires at least one of the listed permissions. */
const permitAny = (...permissions) => (req, res, next) => (
  hasAnyPermission(req.user, permissions) ? next() : res.status(403).json({ error: 'Insufficient permission', required: permissions })
);

module.exports = { authenticate, permit, permitAny, hasPermission, hasAnyPermission };
