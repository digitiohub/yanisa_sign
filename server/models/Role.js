const mongoose = require('mongoose');
// System roles are seeded with companyId null and shared by every tenant;
// custom roles belong to the company that created them.
const schema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
  key: { type: String, required: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: String,
  rank: { type: Number, default: 10 },
  permissions: { type: [String], default: [] },
  isSystem: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
schema.index({ companyId: 1, key: 1 }, { unique: true });
module.exports = mongoose.model('Role', schema);
