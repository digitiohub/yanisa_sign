const nodemailer = require('nodemailer');
const MailSetting = require('../models/MailSetting');
const EmailLog = require('../models/EmailLog');
const { decryptSecret } = require('../utils/secretBox');

/**
 * Shared SMTP transport, configured from the database.
 *
 * Settings live in the MailSetting singleton so an administrator can change
 * them from Administration > Mail without a redeploy. That rules out building
 * the transporter at module load - there is no database connection yet - so it
 * is built lazily and then cached.
 *
 * The cache is still "create once, reuse for every send": it is keyed on the
 * settings row's updatedAt, so a transporter is rebuilt only when an
 * administrator actually saves a change, not per request. The old pool is
 * closed on rebuild so its sockets are not leaked.
 */
let cached = { transporter: null, stamp: null };

/** Reads the singleton, including the encrypted password. */
const loadSetting = () => MailSetting.findOne({ key: 'global' }).select('+passwordEncrypted').lean();

const fromHeader = setting => `"${setting.fromName || 'Yanisa Sign'}" <${setting.fromEmail}>`;

/**
 * Build a transporter from a plain config object.
 *
 * Shared by the live mailer and the "send test email" endpoint, so what an
 * administrator tests is exactly what production will use.
 */
function buildTransport({ host, port, secure, username, password }) {
  return nodemailer.createTransport({
    host,
    port: Number(port || 587),
    secure: Boolean(secure),
    auth: username ? { user: username, pass: password } : undefined,
    pool: true,
    maxConnections: 5,
    // Resend and SES both drop long-lived sockets; recycling avoids a stale
    // connection surfacing as a hung send.
    maxMessages: 100,
  });
}

/** Drops the cached pool so the next send re-reads the database. */
function invalidateMailer() {
  if (cached.transporter) cached.transporter.close();
  cached = { transporter: null, stamp: null };
}

/**
 * The live mailer, or null when mail is not configured or is switched off.
 * Callers treat null as "no SMTP" and fall back to the dev outbox.
 */
async function getMailer() {
  const setting = await loadSetting();
  if (!setting || !setting.enabled || !setting.host || !setting.fromEmail) return null;

  const stamp = String(setting.updatedAt);
  // fromEmail is handed back alongside the header because one caller
  // (sendRequestObservers) uses the sender address as a recipient too.
  if (cached.transporter && cached.stamp === stamp) return { transporter: cached.transporter, from: fromHeader(setting), fromEmail: setting.fromEmail, host: setting.host };

  invalidateMailer();
  const transporter = buildTransport({
    host: setting.host, port: setting.port, secure: setting.secure,
    username: setting.username, password: decryptSecret(setting.passwordEncrypted) || '',
  });
  // Verified once per configuration, not per send, so a bad host or credential
  // is logged as soon as it is first used rather than failing silently.
  transporter.verify()
    .then(() => console.log(`[mailer] SMTP ready on ${setting.host} (pooled, max 5 connections)`))
    .catch(err => console.error('[mailer] SMTP verification failed:', err.message));
  cached = { transporter, stamp };
  return { transporter, from: fromHeader(setting), fromEmail: setting.fromEmail, host: setting.host };
}

/**
 * Called once after the database connects so a broken configuration shows up
 * in the boot log instead of on the first user's sign-in. Never rejects: mail
 * being down must not stop the server from serving.
 */
async function warmMailer() {
  try {
    const mailer = await getMailer();
    if (!mailer) console.log('[mailer] SMTP is not configured - one-time codes will be logged to the console.');
  } catch (err) {
    console.error('[mailer] could not load mail settings:', err.message);
  }
}

/**
 * The single way this app sends mail.
 *
 * Everything - sign-in codes, invitations, signature requests, completion
 * notices - goes through here, so Administration > Email log has one row per
 * attempt whether it succeeded, failed or was skipped.
 *
 * `meta.devOutbox` is a callback rather than an import: it lets the caller
 * write its own development fallback (which does contain codes and links)
 * without this module having to require services/email.js, which would be a
 * circular import.
 */
async function deliver(payload, meta = {}) {
  const started = Date.now();
  const entry = {
    to: payload.to,
    cc: Array.isArray(payload.cc) ? payload.cc : [],
    bcc: Array.isArray(payload.bcc) ? payload.bcc : [],
    subject: payload.subject || '',
    template: meta.template || 'unknown',
    attachments: (payload.attachments || []).map(a => a.filename).filter(Boolean),
    companyId: meta.companyId,
    documentId: meta.documentId,
    actorUserId: meta.actorUserId,
  };
  // A logging failure must never take a send down with it.
  const record = fields => EmailLog.create({ ...entry, ...fields }).catch(err => console.error('[mailer] could not write the email log:', err.message));

  const mailer = await getMailer();
  if (!mailer) {
    const message = 'SMTP is not configured. Set it up in Administration > Mail.';
    if (process.env.NODE_ENV === 'production') {
      await record({ status: 'failed', error: message, durationMs: Date.now() - started });
      throw new Error(message);
    }
    if (meta.devOutbox) await meta.devOutbox();
    await record({ status: 'skipped', error: 'Mail is switched off; written to the development outbox.', durationMs: Date.now() - started });
    return { delivered: false, devOutbox: true };
  }

  try {
    const info = await mailer.transporter.sendMail({ from: mailer.from, ...payload });
    await record({ status: 'sent', host: mailer.host, messageId: info?.messageId, durationMs: Date.now() - started });
    return { delivered: true, messageId: info?.messageId };
  } catch (err) {
    await record({ status: 'failed', host: mailer.host, error: err.message, durationMs: Date.now() - started });
    throw err;
  }
}

module.exports = { getMailer, deliver, buildTransport, invalidateMailer, warmMailer, loadSetting, fromHeader };
