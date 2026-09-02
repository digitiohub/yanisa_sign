const mongoose = require('mongoose');
// One row per refresh token. The token itself is never stored, only its hash.
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  refreshTokenHash: { type: String, required: true, unique: true, index: true },
  ipAddress: String,
  userAgent: String,
  device: String,
  browser: String,
  os: String,
  lastActivityAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: true },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  revokedReason: String,
}, { timestamps: true });
module.exports = mongoose.model('Session', schema);
