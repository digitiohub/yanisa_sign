const fs = require('fs/promises');
const path = require('path');
const { deliver } = require('../config/mailer');

const brand = '#1d4ed8';

// Same shell as services/email.js so a login code does not look like it came
// from a different product than the invitation that preceded it.
const template = (otp, minutes) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:auto;color:#172033">
  <p style="color:${brand};font-weight:700;letter-spacing:.14em;font-size:12px">YANISA SIGN</p>
  <h2 style="margin:8px 0 16px">Your sign-in code</h2>
  <p>Use this code to finish signing in:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:.35em;background:#f1f5f9;border-radius:12px;padding:16px;text-align:center;margin:20px 0">${otp}</p>
  <p>This code expires in ${minutes} minute${minutes === 1 ? '' : 's'} and can be used once.</p>
  <p style="color:#64748b;font-size:13px">If you did not try to sign in, ignore this email and consider changing your password.</p>
  <p style="margin-top:28px;color:#64748b;font-size:12px">Yanisa Sign &middot; This is an automated message.</p></div>`;

// Mirrors the dev outbox in services/email.js: without SMTP configured the
// code is still recoverable from storage/dev-outbox.log, so the whole sign-in
// flow can be followed end to end locally.
async function writeDevOutbox(entry) {
  try {
    const root = path.resolve(process.env.STORAGE_PATH || path.join(__dirname, '..', '..', 'storage'));
    await fs.mkdir(root, { recursive: true });
    await fs.appendFile(path.join(root, 'dev-outbox.log'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
  } catch (err) {
    console.error('[sendOTP] dev outbox write failed:', err.message);
  }
}

/**
 * Deliver one login code.
 *
 * Callers invoke this WITHOUT awaiting it - see routes/auth.js. Rejections
 * must therefore be handled by the caller's .catch, and this function must
 * never be relied on to shape the HTTP response.
 */
async function sendOTP(email, otp, minutes) {
  // Routed through deliver() so the send lands in Administration > Email log
  // like every other message. The code itself goes only to the development
  // outbox callback - the log row deliberately never sees it.
  return deliver({
    to: email,
    subject: 'Your Yanisa Sign sign-in code',
    text: `Your Yanisa Sign sign-in code is ${otp}. It expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    html: template(otp, minutes),
  }, {
    template: 'login_otp',
    devOutbox: async () => {
      console.log(`[mail:dev] login code for ${email} :: ${otp}`);
      await writeDevOutbox({ to: email, template: 'login_otp', subject: 'Your Yanisa Sign sign-in code', variables: { otp } });
    },
  });
}

module.exports = { sendOTP };
