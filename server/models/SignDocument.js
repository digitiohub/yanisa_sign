const mongoose = require('mongoose');

const signerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: String,
  type: { type: String, enum: ['Candidate', 'Employee', 'HR', 'Manager', 'External Signer'], default: 'Candidate' },
  order: { type: Number, default: 1 },
  status: { type: String, enum: ['pending', 'viewed', 'completed', 'declined'], default: 'pending' },
  completedAt: Date,
}, { timestamps: true });

const fieldSchema = new mongoose.Schema({
  signerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  pageNumber: { type: Number, required: true, min: 1 },
  type: { type: String, required: true, enum: ['signature', 'initials', 'name', 'email', 'phone', 'company', 'text', 'multiline', 'checkbox', 'radio', 'selection', 'date', 'strikethrough', 'stamp'] },
  x: { type: Number, required: true, min: 0, max: 1 },
  y: { type: Number, required: true, min: 0, max: 1 },
  width: { type: Number, required: true, min: 0.01, max: 1 },
  height: { type: Number, required: true, min: 0.01, max: 1 },
  required: { type: Boolean, default: true },
  label: String,
  placeholder: String,
  settings: mongoose.Schema.Types.Mixed,
  value: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

const auditSchema = new mongoose.Schema({
  event: { type: String, required: true }, actorType: String, actorId: String,
  signerId: mongoose.Schema.Types.ObjectId, ipAddress: String, userAgent: String,
  metadata: mongoose.Schema.Types.Mixed, createdAt: { type: Date, default: Date.now, immutable: true },
}, { _id: true });

const schema = new mongoose.Schema({
  referenceNumber: { type: String, unique: true, index: true, required: true },
  title: { type: String, required: true, trim: true },
  originalFile: { type: String, required: true }, signedFile: String, certificateFile: String,
  originalHash: { type: String, required: true }, signedHash: String, certificateHash: String,
  pageCount: { type: Number, required: true },
  status: { type: String, enum: ['Draft', 'Ready to Send', 'Sent', 'Delivered', 'Viewed', 'Pending Signature', 'Partially Signed', 'Signed', 'Declined', 'Expired', 'Cancelled', 'Failed'], default: 'Draft', index: true },
  createdBy: { type: String, required: true },
  relatedEntityType: String, relatedEntityId: String,
  signers: [signerSchema], fields: [fieldSchema], audits: [auditSchema],
  expiresAt: Date, sentAt: Date, completedAt: Date, cancelledAt: Date,
  subject: String, message: String, cc: [String], bcc: [String], reminders: { type: Boolean, default: false },
}, { timestamps: true });

schema.index({ title: 'text', referenceNumber: 'text', 'signers.name': 'text', 'signers.email': 'text' });
module.exports = mongoose.model('SignDocument', schema);
