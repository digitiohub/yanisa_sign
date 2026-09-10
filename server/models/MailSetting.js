const mongoose = require('mongoose');

/**
 * The install's outgoing mail configuration.
 *
 * A single global document rather than a per-company one: SMTP is delivery
 * infrastructure, and the login code has to be sent before a company is
 * necessarily known. `key` is pinned to 'global' and unique, which is what
 * makes the singleton impossible to duplicate by accident.
 */
const schema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true, enum: ['global'] },

  // Off by default so a half-filled form never starts sending real mail.
  enabled: { type: Boolean, default: false },
  host: { type: String, trim: true, default: '' },
  port: { type: Number, default: 587 },
  // Implicit TLS (port 465). Resend and SES both use STARTTLS on 587, where
  // this stays false.
  secure: { type: Boolean, default: false },
  username: { type: String, trim: true, default: '' },

  // AES-256-GCM ciphertext from utils/secretBox.js. `select: false` so it is
  // never loaded by accident and cannot leak through a stray .lean() that is
  // passed to res.json.
  passwordEncrypted: { type: String, default: '', select: false },

  fromName: { type: String, trim: true, default: 'Yanisa Sign' },
  fromEmail: { type: String, trim: true, lowercase: true, default: '' },

  // Result of the last "send test email", shown in Administration so an
  // operator can see whether the current settings actually work.
  lastTestedAt: Date,
  lastTestOk: Boolean,
  lastTestError: String,
  updatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('MailSetting', schema);
