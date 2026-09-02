const mongoose = require('mongoose');
// Never records the password or any part of it.
const schema = new mongoose.Schema({
  email: { type: String, lowercase: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
  success: { type: Boolean, default: false },
  reason: String,
  ipAddress: String,
  userAgent: String,
}, { timestamps: true });
schema.index({ createdAt: -1 });
module.exports = mongoose.model('LoginAttempt', schema);
