const mongoose = require('mongoose');

/**
 * One live login code per email address.
 *
 * `secret` is never a plain or reusable value: it is the HMAC-SHA256 output
 * derived in utils/otp.js from the address, the OTP_SECRET master key and a
 * per-request nonce. The six-digit code itself is never written down anywhere
 * - it only exists long enough to be put in an email.
 */
const schema = new mongoose.Schema({
  // Unique so a resend replaces the previous code rather than leaving two
  // valid codes alive at once (see the upsert in routes/auth.js).
  email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  secret: { type: String, required: true },
  // Which flow issued this code. A code minted after a password check must not
  // be redeemable by the passwordless endpoint, and vice versa - otherwise the
  // weaker flow could be used to cash in the stronger one's code.
  scope: { type: String, enum: ['login_mfa', 'passwordless'], default: 'passwordless', index: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

// TTL index: MongoDB's background monitor removes the document once
// `expiresAt` passes, so expired codes are cleaned up without a cron job and
// the collection cannot grow without bound. `expires: 0` means "delete at the
// instant stored in this field" rather than "N seconds after it".
//
// The monitor only runs about once a minute, so a document can outlive its
// own expiry by up to 60 seconds. That is exactly why /otp/verify re-checks
// expiresAt in application code instead of trusting the index alone.
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpSecret', schema);
