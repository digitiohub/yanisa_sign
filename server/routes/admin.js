const express = require('express');
const { z } = require('zod');

const User = require('../models/User');
const Role = require('../models/Role');
const Workspace = require('../models/Workspace');
const Session = require('../models/Session');
const ActivityLog = require('../models/ActivityLog');
const LoginAttempt = require('../models/LoginAttempt');
const SignDocument = require('../models/SignDocument');
const Company = require('../models/Company');
const { authenticate, permit } = require('../middleware/auth');
const { logAuditEvent } = require('../services/audit');
const { issueOtp } = require('../services/otp');
const { sendEmail } = require('../services/email');
const { PERMISSIONS, PERMISSION_KEYS, hasPermission } = require('../config/permissions');

const router = express.Router();
router.use(authenticate);

const validate = schema => (req, res, next) => {
  const result = schema.safeParse(req.body || {});
  if (!result.success) return res.status(400).json({ error: result.error.issues[0]?.message || 'Invalid request' });
  req.body = result.data;
  return next();
};
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** Every admin query is scoped to the company on the session, never the body. */
const scope = req => ({ companyId: req.user.companyId });
const isSelf = (req, id) => String(req.user._id) === String(id);

// A role may only be handed out by someone who already ranks at least as high.
async function assignableRole(req, roleId) {
  const role = await Role.findOne({ _id: roleId, $or: [{ companyId: null }, { companyId: req.user.companyId }] }).lean();
  if (!role) return { error: 'That role does not exist.' };
  if (role.rank > (req.user.roleRank || 0)) return { error: 'You cannot assign a role with more access than your own.' };
  return { role };
}

async function loadManageableUser(req, id) {
  const user = await User.findOne({ _id: id, ...scope(req), deletedAt: null });
  if (!user) return { error: 'User not found', status: 404 };
  const role = await Role.findById(user.roleId).lean();
  if ((role?.rank || 0) > (req.user.roleRank || 0)) return { error: 'You cannot manage a user with more access than your own.', status: 403 };
  return { user, role };
}

const userSummary = (user, role, workspace) => ({
  id: user._id,
  firstName: user.firstName, lastName: user.lastName, fullName: `${user.firstName} ${user.lastName}`.trim(),
  email: user.email, phone: user.phone, status: user.status, emailVerified: user.emailVerified,
  role: role ? { id: role._id, key: role.key, name: role.name, rank: role.rank } : null,
  workspace: workspace ? { id: workspace._id, name: workspace.name } : null,
  lastLoginAt: user.lastLoginAt, lastActivityAt: user.lastActivityAt, lastLoginIp: user.lastLoginIp,
  createdAt: user.createdAt, invitedAt: user.invitedAt, passwordChangedAt: user.passwordChangedAt,
  lockedUntil: user.lockedUntil,
});

async function decorate(req, users) {
  const [roles, workspaces] = await Promise.all([
    Role.find({ $or: [{ companyId: null }, scope(req)] }).lean(),
    Workspace.find(scope(req)).lean(),
  ]);
  const roleById = new Map(roles.map(role => [String(role._id), role]));
  const workspaceById = new Map(workspaces.map(workspace => [String(workspace._id), workspace]));
  return users.map(user => userSummary(user, roleById.get(String(user.roleId)), workspaceById.get(String(user.workspaceId))));
}

// --------------------------------------------------------------- users

router.get('/users', permit('users.view'), async (req, res, next) => {
  try {
    const filter = { ...scope(req), deletedAt: null };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.roleId) filter.roleId = req.query.roleId;
    if (req.query.workspaceId) filter.workspaceId = req.query.workspaceId;
    if (req.query.lastLoginBefore) filter.$or = [{ lastLoginAt: { $lt: new Date(req.query.lastLoginBefore) } }, { lastLoginAt: null }];
    if (req.query.q) {
      const term = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$and = [{ $or: [{ firstName: term }, { lastName: term }, { email: term }] }];
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).limit(limit).skip(Number(req.query.skip) || 0).lean(),
      User.countDocuments(filter),
    ]);
    return res.json({ users: await decorate(req, users), total });
  } catch (err) { return next(err); }
});

router.post('/users', permit('users.create'), validate(z.object({
  firstName: z.string().trim().min(1, 'First name is required.'),
  lastName: z.string().trim().optional().default(''),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  phone: z.string().trim().optional(),
  roleId: objectId,
  workspaceId: objectId.optional(),
  status: z.enum(['invited', 'active']).optional().default('invited'),
})), async (req, res, next) => {
  try {
    const { role, error } = await assignableRole(req, req.body.roleId);
    if (error) return res.status(403).json({ error });
    const existing = await User.findOne({ ...scope(req), email: req.body.email, deletedAt: null });
    if (existing) return res.status(409).json({ error: 'A user with that email already exists.' });
    if (req.body.workspaceId && !(await Workspace.findOne({ _id: req.body.workspaceId, ...scope(req) }))) return res.status(400).json({ error: 'That workspace does not exist.' });

    // Created without a password on purpose: the invitation flow sets it.
    const user = await User.create({
      ...scope(req),
      workspaceId: req.body.workspaceId || req.user.workspaceId,
      roleId: role._id,
      firstName: req.body.firstName, lastName: req.body.lastName, email: req.body.email, phone: req.body.phone,
      status: 'invited', invitedAt: new Date(), createdBy: req.user._id,
    });

    const company = await Company.findById(req.user.companyId).lean();
    const issued = await issueOtp({ user, email: user.email, purpose: 'email_verification', ip: req.ip });
    if (issued.otp) {
      await sendEmail({ to: user.email, template: 'user_invitation', variables: { firstName: user.firstName, email: user.email, otp: issued.otp, expiresInMinutes: issued.expiresInMinutes, invitedByName: req.user.fullName, companyName: company?.name || 'Yanisa', roleName: role.name } });
    }
    await logAuditEvent({ req, action: 'user.created', entityType: 'user', entityId: user._id, entityLabel: user.email, description: `${req.user.fullName} invited ${user.email} as ${role.name}`, after: { email: user.email, role: role.key, status: user.status, workspaceId: user.workspaceId } });
    const [summary] = await decorate(req, [user.toObject()]);
    return res.status(201).json(summary);
  } catch (err) { return next(err); }
});

router.get('/users/:id', permit('users.view'), async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, ...scope(req), deletedAt: null }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const [summary] = await decorate(req, [user]);
    const [documentsCreated, documentsSent, sessions, activity, failedLogins, recentDocuments] = await Promise.all([
      SignDocument.countDocuments({ ...scope(req), createdByUserId: user._id }),
      ActivityLog.countDocuments({ ...scope(req), actorUserId: user._id, action: 'document.sent' }),
      Session.find({ userId: user._id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastActivityAt: -1 }).lean(),
      ActivityLog.find({ ...scope(req), actorUserId: user._id }).sort({ createdAt: -1 }).limit(25).lean(),
      LoginAttempt.find({ userId: user._id, success: false }).sort({ createdAt: -1 }).limit(10).lean(),
      SignDocument.find({ ...scope(req), createdByUserId: user._id }).sort({ updatedAt: -1 }).limit(10).select('title referenceNumber status updatedAt createdAt').lean(),
    ]);
    return res.json({
      user: summary,
      stats: { documentsCreated, documentsSent, documentsEdited: await ActivityLog.countDocuments({ ...scope(req), actorUserId: user._id, action: { $in: ['document.updated', 'document.design_saved'] } }) },
      sessions: sessions.map(session => ({ id: session._id, browser: session.browser, os: session.os, device: session.device, ipAddress: session.ipAddress, createdAt: session.createdAt, lastActivityAt: session.lastActivityAt })),
      activity, failedLogins, recentDocuments,
    });
  } catch (err) { return next(err); }
});

router.patch('/users/:id', permit('users.edit'), validate(z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  roleId: objectId.optional(),
  workspaceId: objectId.nullable().optional(),
})), async (req, res, next) => {
  try {
    const { user, role, error, status } = await loadManageableUser(req, req.params.id);
    if (error) return res.status(status).json({ error });

    const before = { firstName: user.firstName, lastName: user.lastName, phone: user.phone, roleId: String(user.roleId), workspaceId: user.workspaceId ? String(user.workspaceId) : null };
    let nextRole = role;
    if (req.body.roleId && String(req.body.roleId) !== String(user.roleId)) {
      if (isSelf(req, user._id)) return res.status(400).json({ error: 'You cannot change your own role.' });
      const assignable = await assignableRole(req, req.body.roleId);
      if (assignable.error) return res.status(403).json({ error: assignable.error });
      // Never let the last super admin lose the role.
      if (role?.key === 'super_admin') {
        const remaining = await User.countDocuments({ ...scope(req), roleId: role._id, status: 'active', deletedAt: null, _id: { $ne: user._id } });
        if (!remaining) return res.status(400).json({ error: 'The organisation must keep at least one active Super Admin.' });
      }
      nextRole = assignable.role;
      user.roleId = assignable.role._id;
    }
    for (const field of ['firstName', 'lastName', 'phone']) if (req.body[field] !== undefined) user[field] = req.body[field];
    if (req.body.workspaceId !== undefined) {
      if (req.body.workspaceId && !(await Workspace.findOne({ _id: req.body.workspaceId, ...scope(req) }))) return res.status(400).json({ error: 'That workspace does not exist.' });
      user.workspaceId = req.body.workspaceId || undefined;
    }
    user.updatedBy = req.user._id;
    await user.save();

    const after = { firstName: user.firstName, lastName: user.lastName, phone: user.phone, roleId: String(user.roleId), workspaceId: user.workspaceId ? String(user.workspaceId) : null };
    if (before.roleId !== after.roleId) {
      await logAuditEvent({ req, action: 'user.role_changed', entityType: 'user', entityId: user._id, entityLabel: user.email, description: `${req.user.fullName} changed the role of ${user.email} from ${role?.name} to ${nextRole?.name}`, before: { role: role?.key }, after: { role: nextRole?.key } });
      await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokedBy: req.user._id, revokedReason: 'role_changed' });
    }
    await logAuditEvent({ req, action: 'user.updated', entityType: 'user', entityId: user._id, entityLabel: user.email, description: `${req.user.fullName} updated ${user.email}`, before, after });
    const [summary] = await decorate(req, [user.toObject()]);
    return res.json(summary);
  } catch (err) { return next(err); }
});

const STATUS_ACTIONS = { activate: 'active', deactivate: 'inactive', suspend: 'suspended' };
for (const [action, nextStatus] of Object.entries(STATUS_ACTIONS)) {
  router.post(`/users/:id/${action}`, permit('users.edit'), async (req, res, next) => {
    try {
      const { user, role, error, status } = await loadManageableUser(req, req.params.id);
      if (error) return res.status(status).json({ error });
      if (isSelf(req, user._id)) return res.status(400).json({ error: 'You cannot change your own account status.' });
      if (nextStatus !== 'active' && role?.key === 'super_admin') {
        const remaining = await User.countDocuments({ ...scope(req), roleId: role._id, status: 'active', deletedAt: null, _id: { $ne: user._id } });
        if (!remaining) return res.status(400).json({ error: 'The organisation must keep at least one active Super Admin.' });
      }
      const before = user.status;
      if (nextStatus === 'active' && user.status === 'invited') return res.status(400).json({ error: 'This user has not accepted their invitation yet. Resend the invitation instead.' });
      user.status = nextStatus;
      user.updatedBy = req.user._id;
      if (nextStatus === 'active') { user.activatedAt = new Date(); user.failedLoginCount = 0; user.lockedUntil = undefined; }
      else { user.deactivatedAt = new Date(); }
      await user.save();

      // Losing access ends every session immediately; documents are untouched.
      if (nextStatus !== 'active') await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokedBy: req.user._id, revokedReason: `user_${nextStatus}` });
      await sendEmail({ to: user.email, template: nextStatus === 'active' ? 'account_activated' : 'account_suspended', variables: { firstName: user.firstName, status: nextStatus, companyName: 'Yanisa' } }).catch(() => {});
      await logAuditEvent({ req, action: `user.${action}d`, entityType: 'user', entityId: user._id, entityLabel: user.email, description: `${req.user.fullName} set ${user.email} to ${nextStatus}`, before: { status: before }, after: { status: nextStatus } });
      const [summary] = await decorate(req, [user.toObject()]);
      return res.json(summary);
    } catch (err) { return next(err); }
  });
}

router.post('/users/:id/revoke-sessions', permit('sessions.revoke'), async (req, res, next) => {
  try {
    const { user, error, status } = await loadManageableUser(req, req.params.id);
    if (error) return res.status(status).json({ error });
    const result = await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokedBy: req.user._id, revokedReason: 'admin_revoked' });
    await logAuditEvent({ req, action: 'session.admin_revoked', entityType: 'session', entityId: user._id, entityLabel: user.email, description: `${req.user.fullName} signed ${user.email} out of ${result.modifiedCount} session(s)` });
    return res.json({ ok: true, revoked: result.modifiedCount });
  } catch (err) { return next(err); }
});

// Never exposes or sets a password: it ends sessions and mails a fresh code.
router.post('/users/:id/reset-access', permit('users.edit'), async (req, res, next) => {
  try {
    const { user, error, status } = await loadManageableUser(req, req.params.id);
    if (error) return res.status(status).json({ error });
    await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokedBy: req.user._id, revokedReason: 'access_reset' });
    user.sessionsValidFrom = new Date();
    user.failedLoginCount = 0;
    user.lockedUntil = undefined;
    await user.save();

    const purpose = user.status === 'invited' ? 'email_verification' : 'password_reset';
    const issued = await issueOtp({ user, email: user.email, purpose, ip: req.ip, force: true });
    if (issued.otp) await sendEmail({ to: user.email, template: 'access_reset', variables: { firstName: user.firstName, email: user.email, otp: issued.otp, expiresInMinutes: issued.expiresInMinutes } });
    await logAuditEvent({ req, action: 'user.access_reset', entityType: 'user', entityId: user._id, entityLabel: user.email, description: `${req.user.fullName} reset access for ${user.email}`, metadata: { sessionsRevoked: true, codeSent: Boolean(issued.otp) } });
    return res.json({ ok: true, message: `Sessions revoked and a new code was sent to ${user.email}.` });
  } catch (err) { return next(err); }
});

router.post('/users/:id/resend-invitation', permit('users.create'), async (req, res, next) => {
  try {
    const { user, role, error, status } = await loadManageableUser(req, req.params.id);
    if (error) return res.status(status).json({ error });
    if (user.status !== 'invited') return res.status(400).json({ error: 'That user has already accepted their invitation.' });
    const issued = await issueOtp({ user, email: user.email, purpose: 'email_verification', ip: req.ip, force: true });
    if (issued.error) return res.status(429).json({ error: issued.error });
    const company = await Company.findById(req.user.companyId).lean();
    await sendEmail({ to: user.email, template: 'user_invitation', variables: { firstName: user.firstName, email: user.email, otp: issued.otp, expiresInMinutes: issued.expiresInMinutes, invitedByName: req.user.fullName, companyName: company?.name || 'Yanisa', roleName: role?.name || 'User' } });
    await logAuditEvent({ req, action: 'user.invitation_resent', entityType: 'user', entityId: user._id, entityLabel: user.email, description: `${req.user.fullName} resent the invitation to ${user.email}` });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

// Soft delete only: documents, signatures and history must survive.
router.delete('/users/:id', permit('users.delete'), async (req, res, next) => {
  try {
    const { user, role, error, status } = await loadManageableUser(req, req.params.id);
    if (error) return res.status(status).json({ error });
    if (isSelf(req, user._id)) return res.status(400).json({ error: 'You cannot remove your own account.' });
    if (role?.key === 'super_admin') {
      const remaining = await User.countDocuments({ ...scope(req), roleId: role._id, status: 'active', deletedAt: null, _id: { $ne: user._id } });
      if (!remaining) return res.status(400).json({ error: 'The organisation must keep at least one active Super Admin.' });
    }
    user.deletedAt = new Date();
    user.status = 'inactive';
    user.updatedBy = req.user._id;
    await user.save();
    await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date(), revokedBy: req.user._id, revokedReason: 'user_deleted' });
    await logAuditEvent({ req, action: 'user.deleted', entityType: 'user', entityId: user._id, entityLabel: user.email, description: `${req.user.fullName} removed ${user.email}`, metadata: { softDelete: true, documentsPreserved: true } });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

// --------------------------------------------------------------- roles

router.get('/permissions', permit('roles.view'), (req, res) => res.json(PERMISSIONS.map(([key, description]) => ({ key, description, module: key.split('.')[0] }))));

router.get('/roles', async (req, res, next) => {
  try {
    const roles = await Role.find({ $or: [{ companyId: null }, scope(req)] }).sort({ rank: -1 }).lean();
    const counts = await User.aggregate([{ $match: { companyId: req.user.companyId, deletedAt: null } }, { $group: { _id: '$roleId', total: { $sum: 1 } } }]);
    const totals = new Map(counts.map(row => [String(row._id), row.total]));
    return res.json(roles.map(role => ({ ...role, userCount: totals.get(String(role._id)) || 0, assignable: role.rank <= (req.user.roleRank || 0) })));
  } catch (err) { return next(err); }
});

router.post('/roles', permit('roles.create'), validate(z.object({
  name: z.string().trim().min(2, 'Role name is required.'),
  description: z.string().trim().optional(),
  rank: z.number().int().min(1).max(99).optional().default(30),
  permissions: z.array(z.string()).default([]),
})), async (req, res, next) => {
  try {
    const unknown = req.body.permissions.filter(permission => !PERMISSION_KEYS.includes(permission));
    if (unknown.length) return res.status(400).json({ error: `Unknown permission: ${unknown[0]}` });
    if (req.body.rank > (req.user.roleRank || 0)) return res.status(403).json({ error: 'You cannot create a role ranked above your own.' });
    const granted = req.body.permissions.filter(permission => !hasPermission(req.user, permission));
    if (granted.length) return res.status(403).json({ error: `You cannot grant a permission you do not hold: ${granted[0]}` });

    const key = req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (await Role.findOne({ companyId: req.user.companyId, key })) return res.status(409).json({ error: 'A role with that name already exists.' });
    const role = await Role.create({ ...scope(req), key, name: req.body.name, description: req.body.description, rank: req.body.rank, permissions: req.body.permissions, createdBy: req.user._id });
    await logAuditEvent({ req, action: 'role.created', entityType: 'role', entityId: role._id, entityLabel: role.name, description: `${req.user.fullName} created the role ${role.name}`, after: { key: role.key, permissions: role.permissions } });
    return res.status(201).json(role);
  } catch (err) { return next(err); }
});

router.patch('/roles/:id', permit('roles.edit'), validate(z.object({
  name: z.string().trim().min(2).optional(),
  description: z.string().trim().optional(),
  permissions: z.array(z.string()).optional(),
})), async (req, res, next) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, ...scope(req) });
    if (!role) return res.status(404).json({ error: 'Role not found, or it is a built-in role that cannot be edited.' });
    if (role.rank > (req.user.roleRank || 0)) return res.status(403).json({ error: 'You cannot edit a role ranked above your own.' });
    const before = { name: role.name, permissions: [...role.permissions] };
    if (req.body.permissions) {
      const unknown = req.body.permissions.filter(permission => !PERMISSION_KEYS.includes(permission));
      if (unknown.length) return res.status(400).json({ error: `Unknown permission: ${unknown[0]}` });
      const granted = req.body.permissions.filter(permission => !hasPermission(req.user, permission));
      if (granted.length) return res.status(403).json({ error: `You cannot grant a permission you do not hold: ${granted[0]}` });
      role.permissions = req.body.permissions;
    }
    if (req.body.name) role.name = req.body.name;
    if (req.body.description !== undefined) role.description = req.body.description;
    role.updatedBy = req.user._id;
    await role.save();
    await logAuditEvent({ req, action: 'role.permissions_changed', entityType: 'role', entityId: role._id, entityLabel: role.name, description: `${req.user.fullName} updated the role ${role.name}`, before, after: { name: role.name, permissions: role.permissions } });
    return res.json(role);
  } catch (err) { return next(err); }
});

router.delete('/roles/:id', permit('roles.delete'), async (req, res, next) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, ...scope(req) });
    if (!role) return res.status(404).json({ error: 'Role not found, or it is a built-in role that cannot be deleted.' });
    const inUse = await User.countDocuments({ ...scope(req), roleId: role._id, deletedAt: null });
    if (inUse) return res.status(400).json({ error: `${inUse} user(s) still use this role. Move them first.` });
    await role.deleteOne();
    await logAuditEvent({ req, action: 'role.deleted', entityType: 'role', entityId: role._id, entityLabel: role.name, description: `${req.user.fullName} deleted the role ${role.name}`, before: { key: role.key, permissions: role.permissions } });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------- workspaces

router.get('/workspaces', async (req, res, next) => {
  try {
    const workspaces = await Workspace.find(scope(req)).sort({ name: 1 }).lean();
    const counts = await User.aggregate([{ $match: { companyId: req.user.companyId, deletedAt: null } }, { $group: { _id: '$workspaceId', total: { $sum: 1 } } }]);
    const totals = new Map(counts.map(row => [String(row._id), row.total]));
    return res.json(workspaces.map(workspace => ({ ...workspace, userCount: totals.get(String(workspace._id)) || 0 })));
  } catch (err) { return next(err); }
});

router.post('/workspaces', permit('settings.edit'), validate(z.object({ name: z.string().trim().min(2, 'Workspace name is required.'), description: z.string().trim().optional() })), async (req, res, next) => {
  try {
    if (await Workspace.findOne({ ...scope(req), name: req.body.name })) return res.status(409).json({ error: 'A workspace with that name already exists.' });
    const workspace = await Workspace.create({ ...scope(req), name: req.body.name, description: req.body.description, createdBy: req.user._id });
    await logAuditEvent({ req, action: 'workspace.created', entityType: 'workspace', entityId: workspace._id, entityLabel: workspace.name, description: `${req.user.fullName} created the workspace ${workspace.name}` });
    return res.status(201).json(workspace);
  } catch (err) { return next(err); }
});

// ------------------------------------------------- activity and audit

function activityFilter(req, category) {
  const filter = { ...scope(req) };
  if (category) filter.category = category;
  if (req.query.actorUserId) filter.actorUserId = req.query.actorUserId;
  if (req.query.documentId) filter.documentId = req.query.documentId;
  if (req.query.module) filter.module = req.query.module;
  if (req.query.action) filter.action = req.query.action;
  if (req.query.entityType) filter.entityType = req.query.entityType;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`);
  }
  if (req.query.q) {
    const term = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ description: term }, { actorName: term }, { actorEmail: term }, { action: term }, { entityLabel: term }];
  }
  return filter;
}

const listEvents = category => async (req, res, next) => {
  try {
    const filter = activityFilter(req, category);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const [events, total] = await Promise.all([
      ActivityLog.find(filter).sort({ createdAt: -1 }).skip(Number(req.query.skip) || 0).limit(limit).lean(),
      ActivityLog.countDocuments(filter),
    ]);
    return res.json({ events, total });
  } catch (err) { return next(err); }
};

router.get('/activity', permit('activity.view'), listEvents('activity'));
router.get('/audit-logs', permit('audit.view'), listEvents('security'));
router.get('/events', permit('activity.view'), listEvents(null));

router.get('/events/:id', permit('activity.view'), async (req, res, next) => {
  try {
    const event = await ActivityLog.findOne({ _id: req.params.id, ...scope(req) }).lean();
    if (!event) return res.status(404).json({ error: 'Activity not found' });
    if (event.category === 'security' && !hasPermission(req.user, 'audit.view')) return res.status(403).json({ error: 'Insufficient permission' });
    return res.json(event);
  } catch (err) { return next(err); }
});

router.get('/actions', permit('activity.view'), async (req, res, next) => {
  try { return res.json(await ActivityLog.distinct('action', scope(req))); }
  catch (err) { return next(err); }
});

// ------------------------------------------------------------ overview

router.get('/dashboard', permit('users.view'), async (req, res, next) => {
  try {
    const companyScope = scope(req);
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [totalUsers, activeUsers, invitedUsers, documentsCreated, documentsSent, pending, completed, declined, recentActivity] = await Promise.all([
      User.countDocuments({ ...companyScope, deletedAt: null }),
      User.countDocuments({ ...companyScope, deletedAt: null, status: 'active' }),
      User.countDocuments({ ...companyScope, deletedAt: null, status: 'invited' }),
      SignDocument.countDocuments(companyScope),
      SignDocument.countDocuments({ ...companyScope, sentAt: { $ne: null } }),
      SignDocument.countDocuments({ ...companyScope, status: { $in: ['Pending Signature', 'Viewed', 'Partially Signed'] } }),
      SignDocument.countDocuments({ ...companyScope, status: 'Signed' }),
      SignDocument.countDocuments({ ...companyScope, status: { $in: ['Declined', 'Failed', 'Cancelled', 'Expired'] } }),
      ActivityLog.find(companyScope).sort({ createdAt: -1 }).limit(12).lean(),
    ]);
    const newUsers = await User.countDocuments({ ...companyScope, deletedAt: null, createdAt: { $gte: since } });
    return res.json({
      cards: { totalUsers, activeUsers, invitedUsers, newUsers, documentsCreated, documentsSent, pending, completed, declined },
      recentActivity,
    });
  } catch (err) { return next(err); }
});

// Presence from lastActivityAt - no polling of anything private.
router.get('/online', permit('users.view'), async (req, res, next) => {
  try {
    const users = await User.find({ ...scope(req), deletedAt: null, status: 'active' }).select('firstName lastName email lastActivityAt lastLoginAt roleId').sort({ lastActivityAt: -1 }).lean();
    const now = Date.now();
    const bucket = user => {
      if (!user.lastActivityAt) return 'offline';
      const minutes = (now - new Date(user.lastActivityAt)) / 60000;
      if (minutes <= 5) return 'online';
      return minutes <= 30 ? 'recent' : 'offline';
    };
    return res.json(users.map(user => ({ id: user._id, fullName: `${user.firstName} ${user.lastName}`.trim(), email: user.email, lastActivityAt: user.lastActivityAt, presence: bucket(user) })));
  } catch (err) { return next(err); }
});

router.get('/login-attempts', permit('audit.view'), async (req, res, next) => {
  try {
    const filter = { companyId: req.user.companyId };
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.onlyFailed === 'true') filter.success = false;
    const attempts = await LoginAttempt.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 50, 200)).lean();
    return res.json(attempts);
  } catch (err) { return next(err); }
});

module.exports = router;
