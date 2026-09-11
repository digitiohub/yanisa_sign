const mongoose = require('mongoose');
const { VERTICAL_KEYS, DEFAULT_VERTICAL } = require('../config/verticals');

const schema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
  roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true, index: true },
  // The business lines this person belongs to - one or several. Outside them
  // they see nothing, so an administrator picks at least one when inviting.
  verticals: { type: [{ type: String, enum: VERTICAL_KEYS }], default: () => [DEFAULT_VERTICAL], index: true },

  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, default: '', trim: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true },
  avatarUrl: String,

  status: { type: String, enum: ['invited', 'active', 'inactive', 'suspended'], default: 'invited', index: true },
  emailVerified: { type: Boolean, default: false },
  passwordHash: { type: String, select: false },
  // Hashes only, so a reset cannot silently reuse the previous password.
  passwordHistory: { type: [String], default: [], select: false },
  passwordChangedAt: Date,

  lastLoginAt: Date,
  lastLoginIp: String,
  lastActivityAt: Date,
  failedLoginCount: { type: Number, default: 0 },
  lockedUntil: Date,
  // Refresh tokens issued before this moment are rejected.
  sessionsValidFrom: { type: Date, default: Date.now },

  invitedAt: Date,
  activatedAt: Date,
  deactivatedAt: Date,
  deletedAt: { type: Date, default: null, index: true },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

schema.index({ companyId: 1, email: 1 }, { unique: true });
schema.virtual('fullName').get(function () { return (this.firstName + ' ' + this.lastName).trim(); });
schema.set('toJSON', { virtuals: true });
schema.set('toObject', { virtuals: true });
module.exports = mongoose.model('User', schema);
