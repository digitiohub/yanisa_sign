const mongoose = require('mongoose');
// Explicit internal sharing of a document with a colleague.
const schema = new mongoose.Schema({
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'SignDocument', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  permission: { type: String, enum: ['view', 'edit'], default: 'view' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
schema.index({ documentId: 1, userId: 1 }, { unique: true });
module.exports = mongoose.model('DocumentMember', schema);
