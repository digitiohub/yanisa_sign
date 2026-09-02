const ActivityLog = require('../models/ActivityLog');

// Anything matching these keys is stripped before an event is written, so
// secrets can never reach the audit trail even if a caller passes a whole
// document as `before`/`after`.
const SECRET_KEY = /(password|otp|token|secret|hash|credential|authorization|cookie)/i;

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return depth > 4 ? '[array]' : value.slice(0, 50).map(item => sanitize(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (depth > 4) return '[object]';
    if (value._bsontype || typeof value.toHexString === 'function') return String(value);
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      output[key] = sanitize(item, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

const moduleOf = action => String(action).split('.')[0];

/**
 * Record one event. `category` splits the operational timeline ("activity")
 * from the administrative trail ("security"); both live in one collection.
 * Never throws - logging must not break the request it describes.
 */
async function logEvent({ req, actor, companyId, workspaceId, action, category = 'activity', entityType, entityId, entityLabel, documentId, description, before, after, metadata, actorType = 'user' }) {
  try {
    const user = actor || req?.user;
    const company = companyId || user?.companyId || req?.user?.companyId;
    if (!company) return null;
    return await ActivityLog.create({
      companyId: company,
      workspaceId: workspaceId || user?.workspaceId || undefined,
      actorUserId: user?._id || user?.id || undefined,
      actorName: user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined,
      actorEmail: user?.email,
      actorType,
      action,
      category,
      module: moduleOf(action),
      entityType,
      entityId: entityId || undefined,
      entityLabel,
      documentId: documentId || undefined,
      description,
      before: before === undefined ? undefined : sanitize(before),
      after: after === undefined ? undefined : sanitize(after),
      metadata: metadata === undefined ? undefined : sanitize(metadata),
      ipAddress: req?.ip,
      userAgent: req?.get?.('user-agent'),
    });
  } catch (err) {
    console.error('Failed to write activity log', err.message);
    return null;
  }
}

const logAuditEvent = options => logEvent({ ...options, category: 'security' });
const logActivity = options => logEvent({ ...options, category: 'activity' });

module.exports = { logEvent, logAuditEvent, logActivity, sanitize };
