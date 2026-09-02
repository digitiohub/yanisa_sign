const mongoose = require('mongoose');
// Only the hash of the code is stored, never the code itself.
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
  email: { type: String, required: true, lowercase: true, index: true },
  purpose: { type: String, required: true, enum: ['email_verification', 'password_reset', 'login_verification', 'email_change'] },
  otpHash: { type: String, required: true },
  pendingEmail: String,
  expiresAt: { type: Date, required: true, index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  usedAt: Date,
  ipAddress: String,
}, { timestamps: true });
module.exports = mongoose.model('OtpRequest', schema);
