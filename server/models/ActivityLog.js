const mongoose = require('mongoose');
// One event stream behind two views: "activity" is the operational timeline,
// "security" is the administrative and audit trail.
const schema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  actorName: String,
  actorEmail: String,
  actorType: { type: String, enum: ['user', 'signer', 'system'], default: 'user' },

  action: { type: String, required: true, index: true },
  category: { type: String, enum: ['activity', 'security'], default: 'activity', index: true },
  module: { type: String, index: true },
  entityType: { type: String, enum: ['user', 'role', 'document', 'template', 'signer', 'field', 'settings', 'authentication', 'session', 'workspace'], required: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
  entityLabel: String,
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'SignDocument', index: true },

  description: { type: String, required: true },
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  metadata: mongoose.Schema.Types.Mixed,

  ipAddress: String,
  userAgent: String,
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ companyId: 1, createdAt: -1 });
schema.index({ companyId: 1, actorUserId: 1, createdAt: -1 });
schema.index({ documentId: 1, createdAt: -1 });
module.exports = mongoose.model('ActivityLog', schema);
