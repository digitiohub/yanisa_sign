const mongoose = require('mongoose');
// A team inside a company. Managers see the documents of their workspace.
const schema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: String,
  isDefault: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
schema.index({ companyId: 1, name: 1 }, { unique: true });
module.exports = mongoose.model('Workspace', schema);
