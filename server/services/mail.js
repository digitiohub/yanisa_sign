const nodemailer = require('nodemailer');

function transport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
}
async function sendSignatureRequest({ signer, document, url }) {
  const client = transport();
  if (!client) { if (process.env.NODE_ENV === 'production') throw new Error('SMTP is not configured'); return { preview: url }; }
  return client.sendMail({ from: `"${process.env.MAIL_FROM_NAME || 'Yanisa HR'}" <${process.env.MAIL_FROM_EMAIL || 'tech@yanisa.in'}>`, to: signer.email, subject: document.subject || `Signature Request – ${document.title}`, html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>Signature request</h2><p>Hello ${signer.name},</p><p>We are pleased to share your offer letter. Please review and electronically sign the document.</p><p><a style="background:#5b45ea;color:white;padding:12px 20px;border-radius:8px;text-decoration:none" href="${url}">REVIEW &amp; SIGN OFFER LETTER</a></p><p><b>Document:</b> ${document.title}</p><p>Regards,<br>HR Team<br>Yanisa</p></div>` });
}
async function sendRequestObservers(document) { const client=transport(); if(!client||(!document.cc?.length&&!document.bcc?.length))return; return client.sendMail({from:`"${process.env.MAIL_FROM_NAME||'Yanisa HR'}" <${process.env.MAIL_FROM_EMAIL||'tech@yanisa.in'}>`,to:process.env.MAIL_FROM_EMAIL||'tech@yanisa.in',cc:document.cc||[],bcc:document.bcc||[],subject:`Signature request sent – ${document.title}`,html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>Signature request sent</h2><p>The document <b>${document.title}</b> has been sent to ${document.signers.map(s=>s.name).join(', ')} for signature.</p><p><b>Reference:</b> ${document.referenceNumber}</p><p>This notification does not contain a signer access link.</p></div>`}) }
async function sendCompletion({ signer, document, notifyHr = false }) {
  const client = transport(); if (!client) return;
  const from = `"${process.env.MAIL_FROM_NAME || 'Yanisa HR'}" <${process.env.MAIL_FROM_EMAIL || 'tech@yanisa.in'}>`;
  await client.sendMail({
    from, to: signer.email,
    subject: `Successfully signed – ${document.title}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2 style="color:#5b45ea">Document signed successfully</h2><p>Hello ${signer.name},</p><p>Your signature for <b>${document.title}</b> has been recorded successfully.</p><p>Your final signed document and Certificate of Completion are attached to this email for your records.</p><p><b>Reference:</b> ${document.referenceNumber}</p><p>Regards,<br>HR Team<br>Yanisa</p></div>`,
    attachments: [
      ...(document.signedFile ? [{ filename: `Signed - ${document.title.replace(/[^a-z0-9._-]/gi, '_')}.pdf`, path: document.signedFile, contentType: 'application/pdf' }] : []),
      ...(document.certificateFile ? [{ filename: `Certificate of completion - ${document.referenceNumber}.pdf`, path: document.certificateFile, contentType: 'application/pdf' }] : []),
    ],
  });
  if (notifyHr && process.env.HR_NOTIFICATION_EMAIL) await client.sendMail({ from, to: process.env.HR_NOTIFICATION_EMAIL, subject: `Signature request completed – ${document.title}`, html: `<p>All signers have completed <b>${document.title}</b>.</p><p>Reference: ${document.referenceNumber}</p>`, attachments: [...(document.signedFile?[{filename:`Signed - ${document.referenceNumber}.pdf`,path:document.signedFile,contentType:'application/pdf'}]:[]),...(document.certificateFile?[{filename:`Certificate of completion - ${document.referenceNumber}.pdf`,path:document.certificateFile,contentType:'application/pdf'}]:[])] });
}
module.exports = { sendSignatureRequest, sendRequestObservers, sendCompletion };
