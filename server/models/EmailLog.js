const mongoose = require('mongoose');

/**
 * One row per outgoing message.
 *
 * Deliberately records envelope and outcome only - never the rendered body,
 * and never the template variables. Those variables carry sign-in codes,
 * password-reset codes and signing links, so a log that included them would
 * hand anyone with Administration access a way to sign in as somebody else.
 * Subject, recipients and status are enough to answer "did it go out, and if
 * not, why".
 */
const schema = new mongoose.Schema({
  to: { type: String, required: true, lowercase: true, trim: true, index: true },
  cc: [String],
  bcc: [String],
  subject: { type: String, default: '' },
  // Which message this was: 'login_otp', 'user_invitation', 'signature_request'...
  template: { type: String, default: 'unknown', index: true },

  //   sent    - the SMTP server accepted it
  //   failed  - the server rejected it, or mail is unconfigured in production
  //   skipped - mail is switched off in a development install; it went to the
  //             dev outbox instead. Not an error.
  status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true, index: true },
  error: String,
  host: String,
  messageId: String,
  durationMs: Number,
  // Filenames only. Attachments are PDFs read from disk at send time.
  attachments: [String],

  // Optional context, so a log line can be traced back to what caused it.
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'SignDocument', index: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

schema.index({ createdAt: -1 });
schema.index({ subject: 'text', to: 'text' });

// Retention. Delivery logs are operational data, not an audit trail, so they
// age out on their own rather than growing without bound. Set
// EMAIL_LOG_RETENTION_DAYS=0 to keep them for ever.
const RETENTION_DAYS = Number(process.env.EMAIL_LOG_RETENTION_DAYS ?? 90);
if (RETENTION_DAYS > 0) schema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 86400 });

module.exports = mongoose.model('EmailLog', schema);
