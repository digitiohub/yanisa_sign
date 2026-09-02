const mongoose = require('mongoose');
// Short-lived single-use tokens: the reset session handed out after a correct
// OTP, and the invitation link mailed to a new user. Hashes only.
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  purpose: { type: String, required: true, enum: ['password_reset', 'invitation'] },
  tokenHash: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  usedAt: Date,
  createdByIp: String,
}, { timestamps: true });
module.exports = mongoose.model('ActionToken', schema);
