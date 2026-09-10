const fs = require('fs/promises');
const path = require('path');
const { deliver } = require('../config/mailer');

// Provider-agnostic mailer. The SMTP server itself is configured in
// Administration > Mail and lives in the database, so nothing here reads
// SMTP_* from the environment; config/mailer.js owns the pooled transport.

const brand = '#1d4ed8';
const appUrl = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

const layout = (title, body) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:auto;color:#172033">
  <p style="color:${brand};font-weight:700;letter-spacing:.14em;font-size:12px">YANISA SIGN</p>
  <h2 style="margin:8px 0 16px">${title}</h2>${body}
  <p style="margin-top:28px;color:#64748b;font-size:12px">Yanisa Sign · This is an automated message.</p></div>`;

const codeBlock = code => `<p style="font-size:32px;font-weight:700;letter-spacing:.35em;background:#f1f5f9;border-radius:12px;padding:16px;text-align:center;margin:20px 0">${code}</p>`;
const button = (href, label) => `<p style="margin:24px 0"><a href="${href}" style="background:${brand};color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>`;

const TEMPLATES = {
  user_invitation: v => ({
    subject: `You have been invited to Yanisa Sign`,
    html: layout('You have been invited to Yanisa Sign', `<p>Hello ${v.firstName},</p>
      <p>${v.invitedByName} invited you to join <b>${v.companyName}</b> on Yanisa Sign as <b>${v.roleName}</b>.</p>
      <p>Follow this link to confirm your email address and choose a password:</p>
      ${button(v.inviteUrl, 'Activate your account')}
      <p style="color:#64748b;font-size:13px">The link works once and expires in ${v.expiresInDays} day${v.expiresInDays === 1 ? '' : 's'}. If you were not expecting this, you can ignore this email.</p>`),
  }),
  email_verification_otp: v => ({
    subject: 'Yanisa Sign Verification Code',
    html: layout('Verify your email address', `<p>Hello ${v.firstName},</p>
      <p>Your verification code is:</p>${codeBlock(v.otp)}
      <p>This code expires in ${v.expiresInMinutes} minutes.</p>
      <p style="color:#64748b;font-size:13px">If you did not request this, you can ignore this email.</p>`),
  }),
  password_reset_otp: v => ({
    subject: 'Yanisa Sign Password Reset Code',
    html: layout('Reset your password', `<p>Hello ${v.firstName},</p>
      <p>Use this code to reset your Yanisa Sign password:</p>${codeBlock(v.otp)}
      <p>This code expires in ${v.expiresInMinutes} minutes and can be used once.</p>
      <p style="color:#64748b;font-size:13px">If you did not request a password reset, you can ignore this email.</p>`),
  }),
  password_changed: v => ({
    subject: 'Your Yanisa Sign password was changed',
    html: layout('Your password was changed', `<p>Hello ${v.firstName},</p>
      <p>The password for your Yanisa Sign account was changed on ${v.changedAt}.</p>
      <p>All other sessions have been signed out.</p>
      <p style="color:#64748b;font-size:13px">If this was not you, contact your administrator immediately.</p>`),
  }),
  email_change_otp: v => ({
    subject: 'Confirm your new email address',
    html: layout('Confirm your new email address', `<p>Hello ${v.firstName},</p>
      <p>Use this code to confirm <b>${v.pendingEmail}</b> as your new Yanisa Sign email address:</p>${codeBlock(v.otp)}
      <p>This code expires in ${v.expiresInMinutes} minutes.</p>`),
  }),
  email_changed_notice: v => ({
    subject: 'Your Yanisa Sign email address was changed',
    html: layout('Your email address was changed', `<p>Hello ${v.firstName},</p>
      <p>The email address on your Yanisa Sign account was changed to <b>${v.newEmail}</b>.</p>
      <p style="color:#64748b;font-size:13px">If this was not you, contact your administrator immediately.</p>`),
  }),
  account_activated: v => ({
    subject: 'Your Yanisa Sign account is active',
    html: layout('Your account is active', `<p>Hello ${v.firstName},</p>
      <p>Your Yanisa Sign account for <b>${v.companyName}</b> is now active.</p>${button(`${appUrl()}/login`, 'Sign in')}`),
  }),
  account_suspended: v => ({
    subject: 'Your Yanisa Sign account access has changed',
    html: layout('Your account access has changed', `<p>Hello ${v.firstName},</p>
      <p>Your Yanisa Sign access has been set to <b>${v.status}</b> by an administrator.</p>
      <p style="color:#64748b;font-size:13px">Contact your administrator if you believe this is a mistake.</p>`),
  }),
  access_reset: v => ({
    subject: 'Set a new Yanisa Sign password',
    html: layout('Set a new password', `<p>Hello ${v.firstName},</p>
      <p>An administrator reset access to your Yanisa Sign account. Use this code to set a new password:</p>${codeBlock(v.otp)}
      ${button(`${appUrl()}/forgot-password?email=${encodeURIComponent(v.email)}`, 'Set a new password')}
      <p style="color:#64748b;font-size:13px">This code expires in ${v.expiresInMinutes} minutes. Existing sessions have been signed out.</p>`),
  }),
  security_alert: v => ({
    subject: 'New sign-in to your Yanisa Sign account',
    html: layout('New sign-in detected', `<p>Hello ${v.firstName},</p>
      <p>A new sign-in was recorded on ${v.at} from ${v.ipAddress || 'an unknown address'} (${v.device || 'unknown device'}).</p>
      <p style="color:#64748b;font-size:13px">If this was not you, change your password immediately.</p>`),
  }),
};

// Without SMTP configured, development writes the message to a local outbox
// so invitations and codes can still be followed end to end.
async function writeDevOutbox(entry) {
  if (process.env.NODE_ENV === 'production') return;
  try {
    const root = path.resolve(process.env.STORAGE_PATH || path.join(__dirname, '..', '..', 'storage'));
    await fs.mkdir(root, { recursive: true });
    await fs.appendFile(path.join(root, 'dev-outbox.log'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
  } catch (err) {
    console.error('Dev outbox write failed', err.message);
  }
}

/**
 * @param {{to:string, template:keyof TEMPLATES, variables?:object, subject?:string, cc?:string[], bcc?:string[], attachments?:object[]}} message
 */
async function sendEmail({ to, template, variables = {}, subject, cc, bcc, attachments, context = {} }) {
  const builder = TEMPLATES[template];
  if (!builder) throw new Error(`Unknown email template: ${template}`);
  const rendered = builder(variables);
  const line = { to, cc, bcc, subject: subject || rendered.subject, html: rendered.html, attachments };
  // deliver() writes the Administration > Email log row and decides between
  // sending, the development outbox and failing loudly in production.
  return deliver(line, {
    template,
    companyId: context.companyId,
    documentId: context.documentId,
    actorUserId: context.actorUserId,
    devOutbox: async () => {
      console.log(`[mail:dev] ${template} -> ${to} :: ${line.subject}${variables.otp ? ` (code ${variables.otp})` : ''}`);
      await writeDevOutbox({ to, template, subject: line.subject, variables });
    },
  });
}

module.exports = { sendEmail, TEMPLATES, writeDevOutbox };
