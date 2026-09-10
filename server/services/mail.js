const { getMailer } = require('../config/mailer');
const { writeDevOutbox } = require('./email');

// The SMTP server is configured in Administration > Mail and stored in the
// database; config/mailer.js owns the single pooled transport that every
// message in the app goes through.
const NOT_CONFIGURED = 'SMTP is not configured. Set it up in Administration > Mail.';
async function sendSignatureRequest({ signer, document, url, waitingOnOthers = false }) {
  const client = await getMailer();
  // Without SMTP the link is written to storage/dev-outbox.log, otherwise a
  // signing link generated in development would be unreachable.
  if (!client) { if (process.env.NODE_ENV === 'production') throw new Error(NOT_CONFIGURED); await writeDevOutbox({ to: signer.email, template: waitingOnOthers ? 'final_approver_pending' : 'signature_request', subject: document.title, variables: { url } }); return { preview: url }; }
  // A final approver cannot act yet, so promising them a signing action would
  // send them to a page that refuses it. They get the link (progress is worth
  // watching) with copy that says what it is.
  const body = waitingOnOthers
    ? `<p>Hello ${signer.name},</p><p>You are the final approver on <b>${document.title}</b>. The other signers have been asked to sign first - you will receive another email as soon as the document is ready for your approval.</p><p>You can follow progress and review what has been signed so far here:</p><p><a style="background:#5b45ea;color:white;padding:12px 20px;border-radius:8px;text-decoration:none" href="${url}">VIEW PROGRESS</a></p>`
    : `<p>Hello ${signer.name},</p><p>We are pleased to share your offer letter. Please review and electronically sign the document.</p><p><a style="background:#5b45ea;color:white;padding:12px 20px;border-radius:8px;text-decoration:none" href="${url}">REVIEW &amp; SIGN OFFER LETTER</a></p>`;
  return client.transporter.sendMail({ from: client.from, to: signer.email, subject: waitingOnOthers ? `Final approval pending – ${document.title}` : (document.subject || `Signature Request – ${document.title}`), html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>${waitingOnOthers ? 'You are the final approver' : 'Signature request'}</h2>${body}<p><b>Document:</b> ${document.title}</p><p>Regards,<br>HR Team<br>Yanisa</p></div>` });
}

/**
 * Sent to the final approver once every other signer has completed. This is
 * the email that actually asks them to sign, so it carries a fresh link.
 */
async function sendFinalApprovalReady({ signer, document, url, signedBy = [] }) {
  const client = await getMailer();
  if (!client) { if (process.env.NODE_ENV === 'production') throw new Error(NOT_CONFIGURED); await writeDevOutbox({ to: signer.email, template: 'final_approval_ready', subject: document.title, variables: { url } }); return { preview: url }; }
  const list = signedBy.length ? `<p>Signed by:</p><ul>${signedBy.map(name => `<li>${name}</li>`).join('')}</ul>` : '';
  return client.transporter.sendMail({
    from: client.from,
    to: signer.email,
    subject: `Ready for your approval – ${document.title}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>Ready for your approval</h2><p>Hello ${signer.name},</p><p>Everyone else has signed <b>${document.title}</b>. You can now review their signatures and add yours to complete the document.</p>${list}<p><a style="background:#5b45ea;color:white;padding:12px 20px;border-radius:8px;text-decoration:none" href="${url}">REVIEW &amp; SIGN</a></p><p><b>Reference:</b> ${document.referenceNumber}</p><p>Regards,<br>HR Team<br>Yanisa</p></div>`,
  });
}
async function sendRequestObservers(document) { const client=await getMailer(); if(!client||(!document.cc?.length&&!document.bcc?.length))return; return client.transporter.sendMail({from:client.from,to:client.fromEmail,cc:document.cc||[],bcc:document.bcc||[],subject:`Signature request sent – ${document.title}`,html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>Signature request sent</h2><p>The document <b>${document.title}</b> has been sent to ${document.signers.map(s=>s.name).join(', ')} for signature.</p><p><b>Reference:</b> ${document.referenceNumber}</p><p>This notification does not contain a signer access link.</p></div>`}) }
async function sendCompletion({ signer, document, notifyHr = false }) {
  const client = await getMailer(); if (!client) { if (process.env.NODE_ENV === 'production') throw new Error(NOT_CONFIGURED); return; }
  const from = client.from;
  await client.transporter.sendMail({
    from, to: signer.email,
    subject: `Successfully signed – ${document.title}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2 style="color:#5b45ea">Document signed successfully</h2><p>Hello ${signer.name},</p><p>Your signature for <b>${document.title}</b> has been recorded successfully.</p><p>Your final signed document and Certificate of Completion are attached to this email for your records.</p><p><b>Reference:</b> ${document.referenceNumber}</p><p>Regards,<br>HR Team<br>Yanisa</p></div>`,
    attachments: [
      ...(document.signedFile ? [{ filename: `Signed - ${document.title.replace(/[^a-z0-9._-]/gi, '_')}.pdf`, path: document.signedFile, contentType: 'application/pdf' }] : []),
      ...(document.certificateFile ? [{ filename: `Certificate of completion - ${document.referenceNumber}.pdf`, path: document.certificateFile, contentType: 'application/pdf' }] : []),
    ],
  });
  if (notifyHr && process.env.HR_NOTIFICATION_EMAIL) await client.transporter.sendMail({ from, to: process.env.HR_NOTIFICATION_EMAIL, subject: `Signature request completed – ${document.title}`, html: `<p>All signers have completed <b>${document.title}</b>.</p><p>Reference: ${document.referenceNumber}</p>`, attachments: [...(document.signedFile?[{filename:`Signed - ${document.referenceNumber}.pdf`,path:document.signedFile,contentType:'application/pdf'}]:[]),...(document.certificateFile?[{filename:`Certificate of completion - ${document.referenceNumber}.pdf`,path:document.certificateFile,contentType:'application/pdf'}]:[])] });
}
module.exports = { sendSignatureRequest, sendFinalApprovalReady, sendRequestObservers, sendCompletion };
