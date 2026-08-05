const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'SignDocument', required: true, index: true },
  signerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true, index: true }, revokedAt: Date, lastAccessedAt: Date,
}, { timestamps: true });
module.exports = mongoose.model('SignAccess', schema);
