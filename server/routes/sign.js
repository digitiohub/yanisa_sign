const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs/promises');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const SignDocument = require('../models/SignDocument');
const SignAccess = require('../models/SignAccess');
const { authenticate, permit } = require('../middleware/auth');
const { documentListFilter, documentAccess, requireDocument } = require('../services/access');
const { logActivity, logAuditEvent } = require('../services/audit');
const DocumentMember = require('../models/DocumentMember');
const User = require('../models/User');
const storage = require('../services/storage');
const mail = require('../services/mail');

const router = express.Router();
const maxSize = Number(process.env.MAX_PDF_SIZE_MB || 20) * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxSize, files: 1 }, fileFilter: (_req, file, cb) => cb(file.mimetype === 'application/pdf' ? null : new Error('Only PDF files are allowed'), file.mimetype === 'application/pdf') });
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const audit = (req, event, metadata = {}, signerId) => ({ event, actorType: req.user ? 'user' : 'signer', actorId: req.user?.email, signerId, ipAddress: req.ip, userAgent: req.get('user-agent'), metadata });
// Mirrors a document event into the central activity log so administrators can
// follow who did what without opening every document.
const trackSigner = (req, doc, signer, action, description, metadata) => logActivity({ req, companyId: doc.companyId, workspaceId: doc.workspaceId, actor: { email: signer?.email, firstName: signer?.name }, actorType: 'signer', action, entityType: 'document', entityId: doc._id, entityLabel: doc.title, documentId: doc._id, description, metadata });
const track = (req, doc, action, description, extra = {}) => logActivity({ req, workspaceId: doc.workspaceId, action, entityType: extra.entityType || 'document', entityId: doc._id, entityLabel: doc.title, documentId: doc._id, description, before: extra.before, after: extra.after, metadata: extra.metadata });
const guard = capability => requireDocument(SignDocument, capability);
const ref = () => `SGN-${new Date().getUTCFullYear()}-${crypto.randomInt(0, 1000000).toString().padStart(6, '0')}`;

async function appendCompletionCertificate(pdf, doc, signingHash) {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.08, .11, .17), muted = rgb(.34, .38, .45), accent = rgb(.29, .15, .28), green = rgb(.02, .55, .18);
  const page1 = pdf.addPage([595, 842]);
  const page2 = pdf.addPage([595, 842]);
  const text = (page, value, x, y, size=9, face=font, color=ink, maxWidth=510) => page.drawText(String(value || ''), { x, y, size, font: face, color, maxWidth, lineHeight: size * 1.25 });
  const rule = (page, y) => page.drawLine({ start:{x:28,y}, end:{x:567,y}, thickness:.7, color:muted });
  const shortHash = value => hash(`${value}:${doc.originalHash}`);

  text(page1, 'YANISA', 28, 795, 20, bold, accent); text(page1, 'Yanisa\nIndia', 205, 796, 9, font, ink);
  text(page1, 'Certificate of Completion', 28, 690, 22, font);
  text(page1, doc.title, 28, 662, 14, bold);
  text(page1, `Printed on ${new Date().toISOString().replace('T',' ').slice(0,19)} UTC`, 28, 642, 8, font, muted);
  text(page1, 'Document Details', 28, 615, 13, font);
  const created = doc.createdAt?.toISOString() || '';
  text(page1, 'Created by:', 28, 592, 9, bold); text(page1, doc.createdBy, 93, 592);
  text(page1, 'Created on:', 28, 576, 9, bold); text(page1, `${created} (UTC)`, 93, 576);
  text(page1, 'Creation IP Address:', 28, 560, 9, bold); text(page1, doc.audits.find(a=>a.event==='document_uploaded')?.ipAddress || 'Recorded by server', 130, 560);
  text(page1, 'Signers:', 28, 544, 9, bold); text(page1, doc.signers.length, 73, 544);
  text(page1, 'Document ID:', 300, 592, 9, bold); text(page1, doc.referenceNumber, 370, 592);
  text(page1, 'Document:', 300, 576, 9, bold); text(page1, doc.title, 360, 576, 8);
  text(page1, 'Signature:', 300, 560, 9, bold); text(page1, signingHash, 300, 543, 7, font, muted, 255);
  text(page1, 'Participants', 28, 507, 13, font);
  text(page1, 'Signatory', 30, 484, 8, font, muted); text(page1, 'Email', 245, 484, 8, font, muted); text(page1, 'Email Verification', 442, 484, 8, font, muted); rule(page1, 476);
  let y = 457;
  for (const signer of doc.signers) {
    text(page1, signer.name, 30, y, 8); text(page1, signer.email, 245, y, 8); text(page1, '[VERIFIED]', 455, y, 8, bold, green);
    text(page1, "Signatory's hash:", 245, y-18, 7, font, muted); text(page1, shortHash(`${signer._id}:${signer.email}:${signer.completedAt}`), 325, y-18, 6.5, font, ink, 225); y -= 55;
  }
  text(page1, 'Email Verification: Each signatory confirmed control of their email inbox by opening a unique, high-entropy signing link.', 28, y+6, 7.5, font, muted, 535);
  y -= 28; text(page1, 'Signing Events', 28, y, 13, font); y -= 25;
  text(page1, 'Action', 30, y, 8, font, muted); text(page1, 'By', 225, y, 8, font, muted); text(page1, 'Date (UTC)', 455, y, 8, font, muted); rule(page1, y-8); y -= 28;
  text(page1, 'Creation', 30, y, 8); text(page1, doc.createdBy, 225, y, 8); text(page1, created, 430, y, 7); y -= 38;
  for (const signer of doc.signers) {
    text(page1, 'Signature', 30, y, 8); text(page1, `${signer.name}\n${signer.email}`, 225, y, 8); text(page1, signer.completedAt?.toISOString() || '', 430, y, 7);
    text(page1, `Signature: ${shortHash(`${signer._id}:signature`)}`, 225, y-25, 6.5, font, muted, 330); y -= 58;
  }
  rule(page1, 45); text(page1, 'Page 1 / 2', 270, 28, 8, font, muted);

  text(page2, "[VALID] The document's integrity is valid.", 385, 805, 8, bold, green);
  text(page2, `The final signed document and this completion history were generated on ${new Date().toISOString()} for: ${doc.signers.map(s=>s.email).join(', ')}.`, 28, 772, 8, font, ink, 535);
  text(page2, 'Access Logs', 28, 735, 14, font);
  text(page2, 'Viewed/downloaded by', 30, 708, 8, font, muted); text(page2, 'Date (UTC)', 320, 708, 8, font, muted); text(page2, 'State', 475, 708, 8, font, muted); rule(page2, 700);
  y = 678;
  const viewed = doc.audits.filter(a=>a.event==='document_viewed');
  for (const signer of doc.signers) {
    const event = viewed.find(a=>String(a.signerId)===String(signer._id));
    text(page2, `${signer.name}  ${signer.email}`, 30, y, 8); text(page2, event?.createdAt?.toISOString() || 'Not recorded', 320, y, 7); text(page2, 'Before Signature', 475, y, 8); y -= 28;
  }
  rule(page2, 45); text(page2, 'Page 2 / 2', 270, 28, 8, font, muted);
}

router.get('/', authenticate, permit('documents.view'), async (req, res, next) => {
  try {
    const query = await documentListFilter(req.user);
    if (req.query.status) query.status = req.query.status;
    if (req.query.ownerId) query.createdByUserId = req.query.ownerId;
    if (req.query.workspaceId) query.workspaceId = req.query.workspaceId;
    if (req.query.from || req.query.to) { query.createdAt = {}; if (req.query.from) query.createdAt.$gte = new Date(req.query.from); if (req.query.to) query.createdAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`); }
    if (req.query.q) query.$text = { $search: req.query.q };
    const docs = await SignDocument.find(query).select('-audits -fields.value').sort({ updatedAt: -1 }).limit(Math.min(Number(req.query.limit) || 200, 500)).lean();
    const owners = await User.find({ _id: { $in: [...new Set(docs.map(d => String(d.createdByUserId)).filter(Boolean))] } }).select('firstName lastName email').lean();
    const byId = new Map(owners.map(owner => [String(owner._id), { id: owner._id, fullName: `${owner.firstName} ${owner.lastName}`.trim(), email: owner.email }]));
    res.json(docs.map(doc => ({ ...doc, owner: byId.get(String(doc.createdByUserId)) || { fullName: doc.createdBy, email: doc.createdBy } })));
  } catch (e) { next(e); }
});

router.post('/upload', authenticate, permit('documents.create'), upload.single('pdf'), async (req, res, next) => {
  try {
    if (!req.file || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') return res.status(400).json({ error: 'A valid PDF is required' });
    let pdf; try { pdf = await PDFDocument.load(req.file.buffer); } catch { return res.status(400).json({ error: 'The PDF is corrupt or unsupported' }); }
    const originalFile = await storage.save('originals', req.file.buffer);
    const doc = await SignDocument.create({ referenceNumber: ref(), title: String(req.body.title || req.file.originalname.replace(/\.pdf$/i, '')).slice(0, 180), originalFile, originalHash: hash(req.file.buffer), pageCount: pdf.getPageCount(), companyId: req.user.companyId, workspaceId: req.user.workspaceId, ownerId: req.user._id, createdByUserId: req.user._id, createdBy: req.user.email, relatedEntityType: req.body.relatedEntityType, relatedEntityId: req.body.relatedEntityId, audits: [audit(req, 'document_uploaded', { filename: req.file.originalname, size: req.file.size })] });
    await track(req, doc, 'document.created', `${req.user.fullName} uploaded "${doc.title}"`, { metadata: { filename: req.file.originalname, pages: doc.pageCount, reference: doc.referenceNumber } });
    res.status(201).json(doc);
  } catch (e) { next(e); }
});

router.get('/:id', authenticate, permit('documents.view'), guard(), async (req, res, next) => {
  try { res.json({ ...req.document.toObject(), access: req.documentAccess }); } catch (e) { next(e); }
});
router.get('/:id/pdf', authenticate, permit('documents.view'), guard(), async (req, res, next) => {
  try {
    const doc = req.document;
    const wantsCopy = req.query.certificate === 'true' || req.query.signed === 'true';
    if (wantsCopy && !req.documentAccess.canDownload) return res.status(403).json({ error: 'You do not have permission to download this document.' });
    const file = req.query.certificate === 'true' && doc.certificateFile ? doc.certificateFile : req.query.signed === 'true' && doc.signedFile ? doc.signedFile : doc.originalFile;
    if (req.query.download === 'true') await track(req, doc, 'document.downloaded', `${req.user.fullName} downloaded "${doc.title}"`, { metadata: { copy: req.query.certificate === 'true' ? 'certificate' : req.query.signed === 'true' ? 'signed' : 'original' } });
    res.type('pdf').send(await fs.readFile(file));
  } catch (e) { next(e); }
});

// Compares the saved design with the incoming one so the activity log can say
// exactly which signer or field changed, and how.
function diffDesign(previous, next) {
  const events = [];
  const signersBefore = new Map(previous.signers.map(signer => [String(signer._id), signer]));
  const signersAfter = new Map(next.signers.map(signer => [String(signer._id), signer]));
  for (const [id, signer] of signersAfter) {
    const before = signersBefore.get(id);
    if (!before) events.push({ action: 'signer.added', entityType: 'signer', description: `added signer ${signer.name} <${signer.email}>`, after: { name: signer.name, email: signer.email, type: signer.type } });
    else if (before.name !== signer.name || before.email !== signer.email || before.type !== signer.type)
      events.push({ action: 'signer.updated', entityType: 'signer', description: `changed signer ${before.name}`, before: { name: before.name, email: before.email, type: before.type }, after: { name: signer.name, email: signer.email, type: signer.type } });
  }
  for (const [id, signer] of signersBefore) if (!signersAfter.has(id)) events.push({ action: 'signer.removed', entityType: 'signer', description: `removed signer ${signer.name}`, before: { name: signer.name, email: signer.email } });

  const round = value => Math.round(Number(value) * 10000) / 10000;
  const box = field => ({ x: round(field.x), y: round(field.y), width: round(field.width), height: round(field.height) });
  const fieldsBefore = new Map(previous.fields.map(field => [String(field._id), field]));
  const fieldsAfter = new Map(next.fields.map(field => [String(field._id), field]));
  const label = field => `${field.label || field.type} field`;
  for (const [id, field] of fieldsAfter) {
    const before = fieldsBefore.get(id);
    if (!before) { events.push({ action: 'field.created', entityType: 'field', description: `added a ${field.type} field on page ${field.pageNumber}`, after: { type: field.type, page: field.pageNumber, ...box(field) } }); continue; }
    if (String(before.signerId) !== String(field.signerId)) {
      const from = signersBefore.get(String(before.signerId)), to = signersAfter.get(String(field.signerId));
      events.push({ action: 'field.assignee_changed', entityType: 'field', description: `reassigned the ${label(field)} from ${from?.name || 'unassigned'} to ${to?.name || 'unassigned'}`, before: { signer: from?.name, signerId: String(before.signerId) }, after: { signer: to?.name, signerId: String(field.signerId) } });
    }
    const moved = round(before.x) !== round(field.x) || round(before.y) !== round(field.y);
    const resized = round(before.width) !== round(field.width) || round(before.height) !== round(field.height);
    if (moved || resized) events.push({ action: resized && !moved ? 'field.resized' : 'field.moved', entityType: 'field', description: `${resized && !moved ? 'resized' : 'moved'} the ${label(field)} on page ${field.pageNumber}`, before: box(before), after: box(field) });
    if (before.label !== field.label || Boolean(before.required) !== Boolean(field.required) || (before.placeholder || '') !== (field.placeholder || ''))
      events.push({ action: 'field.updated', entityType: 'field', description: `changed the properties of the ${label(field)}`, before: { label: before.label, required: before.required, placeholder: before.placeholder }, after: { label: field.label, required: field.required, placeholder: field.placeholder } });
  }
  for (const [id, field] of fieldsBefore) if (!fieldsAfter.has(id)) events.push({ action: 'field.deleted', entityType: 'field', description: `deleted the ${label(field)} from page ${field.pageNumber}`, before: { type: field.type, page: field.pageNumber, ...box(field) } });
  return events;
}

router.put('/:id/design', authenticate, permit('documents.edit'), guard('canEdit'), async (req, res, next) => {
  try {
    const doc = req.document;
    if (!['Draft', 'Ready to Send'].includes(doc.status)) return res.status(409).json({ error: 'A sent document cannot be redesigned' });
    if (!Array.isArray(req.body.signers) || !Array.isArray(req.body.fields)) return res.status(400).json({ error: 'Signers and fields are required' });
    const previous = { signers: doc.signers.map(signer => signer.toObject()), fields: doc.fields.map(field => field.toObject()) };
    doc.signers = req.body.signers; doc.fields = req.body.fields;
    doc.status = doc.signers.length && doc.fields.length ? 'Ready to Send' : 'Draft';
    doc.updatedBy = req.user._id;
    doc.audits.push(audit(req, 'design_saved', { signerCount: doc.signers.length, fieldCount: doc.fields.length }));
    await doc.save();

    for (const event of diffDesign(previous, { signers: doc.signers, fields: doc.fields })) {
      await track(req, doc, event.action, `${req.user.fullName} ${event.description} in "${doc.title}"`, { entityType: event.entityType, before: event.before, after: event.after });
    }
    await track(req, doc, 'document.design_saved', `${req.user.fullName} saved "${doc.title}"`, { metadata: { signers: doc.signers.length, fields: doc.fields.length } });
    res.json(doc);
  } catch (e) { next(e); }
});

router.post('/:id/send', authenticate, permit('documents.send'), guard('canSend'), async (req, res, next) => {
  try {
    const doc = req.document; if (!doc.signers.length) return res.status(400).json({ error: 'Add at least one signer' });
    const signatureSigners = new Set(doc.fields.filter(f => f.type === 'signature').map(f => String(f.signerId))); const missing = doc.signers.filter(s => !signatureSigners.has(String(s._id))); if (missing.length) return res.status(400).json({ error: 'Every signer must have a signature field' });
    doc.expiresAt = new Date(req.body.expiresAt || Date.now() + Number(process.env.DEFAULT_SIGN_VALID_DAYS || 7) * 86400000); if (doc.expiresAt <= new Date()) return res.status(400).json({ error: 'Expiry must be in the future' });
    const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/; const normalizeEmails=value=>Array.isArray(value)?[...new Set(value.map(item=>String(item).trim().toLowerCase()).filter(Boolean))].slice(0,25):[]; const cc=normalizeEmails(req.body.cc),bcc=normalizeEmails(req.body.bcc); const invalid=[...cc,...bcc].find(email=>!emailPattern.test(email)); if(invalid)return res.status(400).json({error:`Invalid CC/BCC email: ${invalid}`});
    doc.subject = String(req.body.subject || `Signature Request – ${doc.title}`).slice(0, 200); doc.message = String(req.body.message || '').slice(0, 5000); doc.cc = cc; doc.bcc = bcc; doc.reminders = Boolean(req.body.reminders); doc.sentAt = new Date(); doc.status = 'Pending Signature';
    const links = [];
    for (const signer of doc.signers) { const token = crypto.randomBytes(32).toString('base64url'); await SignAccess.create({ documentId: doc._id, signerId: signer._id, tokenHash: hash(token), expiresAt: doc.expiresAt }); const url = `${process.env.APP_URL || 'http://localhost:5173'}/sign/request/${token}`; await mail.sendSignatureRequest({ signer, document: doc, url }); links.push({ signer: signer.email, url: process.env.NODE_ENV === 'production' ? undefined : url }); }
    await mail.sendRequestObservers(doc);
    doc.audits.push(audit(req, 'request_sent', { recipients: doc.signers.map(s => s.email) })); doc.updatedBy = req.user._id; await doc.save();
    await track(req, doc, 'document.sent', `${req.user.fullName} sent "${doc.title}" to ${doc.signers.map(s => s.email).join(', ')}`, { metadata: { recipients: doc.signers.map(s => s.email), cc: doc.cc, expiresAt: doc.expiresAt } });
    res.json({ ok: true, links });
  } catch (e) { next(e); }
});

router.post('/:id/cancel', authenticate, permit('documents.send'), guard('canSend'), async (req, res, next) => { try { const doc = req.document; const before = doc.status; doc.status = 'Cancelled'; doc.cancelledAt = new Date(); doc.updatedBy = req.user._id; doc.audits.push(audit(req, 'request_cancelled')); await SignAccess.updateMany({ documentId: doc._id }, { revokedAt: new Date() }); await doc.save(); await track(req, doc, 'document.cancelled', `${req.user.fullName} cancelled "${doc.title}"`, { before: { status: before }, after: { status: 'Cancelled' } }); res.json({ ok: true }); } catch (e) { next(e); } });
router.delete('/:id', authenticate, permit('documents.delete'), guard('canDelete'), async (req, res, next) => { try { const doc = req.document; await logAuditEvent({ req, action: 'document.deleted', entityType: 'document', entityId: doc._id, entityLabel: doc.title, documentId: doc._id, description: `${req.user.fullName} deleted "${doc.title}"`, before: { title: doc.title, reference: doc.referenceNumber, status: doc.status } }); await DocumentMember.deleteMany({ documentId: doc._id }); await Promise.all([doc.originalFile, doc.signedFile, doc.certificateFile].filter(Boolean).map(file=>fs.unlink(file).catch(()=>{})).concat([SignAccess.deleteMany({ documentId: doc._id }), doc.deleteOne()])); res.json({ ok: true }); } catch (e) { next(e); } });
router.post('/:id/resend', authenticate, permit('documents.send'), guard('canSend'), async (req, res, next) => { try { const doc = req.document; if (!['Pending Signature','Viewed','Partially Signed','Expired'].includes(doc.status)) return res.status(409).json({ error: 'This request cannot be resent' }); const expiresAt = new Date(req.body.expiresAt || Date.now()+Number(process.env.DEFAULT_SIGN_VALID_DAYS||7)*86400000); await SignAccess.updateMany({ documentId: doc._id, revokedAt: null }, { revokedAt: new Date() }); for (const signer of doc.signers.filter(s=>s.status!=='completed')) { const token=crypto.randomBytes(32).toString('base64url'); await SignAccess.create({documentId:doc._id,signerId:signer._id,tokenHash:hash(token),expiresAt}); await mail.sendSignatureRequest({signer,document:doc,url:`${process.env.APP_URL||'http://localhost:5173'}/sign/request/${token}`}); } doc.expiresAt=expiresAt; doc.status='Pending Signature'; doc.audits.push(audit(req,'request_resent')); doc.updatedBy=req.user._id; await doc.save(); await track(req, doc, 'document.resent', `${req.user.fullName} resent "${doc.title}"`, { metadata: { expiresAt } }); res.json({ok:true}); } catch(e){next(e)} });
router.get('/:id/audit', authenticate, permit('documents.view'), guard(), async (req, res, next) => { try { const doc = await SignDocument.findById(req.params.id).select('referenceNumber title audits').lean(); res.json(doc); } catch (e) { next(e); } });

async function accessFor(req, res) { const access = await SignAccess.findOne({ tokenHash: hash(req.params.token) }); if (!access) { res.status(404).json({ error: 'This signing link is invalid' }); return null; } const doc = await SignDocument.findById(access.documentId); if (!doc) { res.sendStatus(404); return null; } if (doc.status === 'Signed') { res.status(409).json({ error: 'This document has already been signed and completed' }); return null; } if (access.revokedAt || doc.status === 'Cancelled') { res.status(410).json({ error: 'This signing request has been cancelled' }); return null; } if (access.expiresAt < new Date()) { doc.status = 'Expired'; await doc.save(); res.status(410).json({ error: 'This signature request has expired' }); return null; } return { access, doc, signer: doc.signers.id(access.signerId) }; }
router.get('/request/:token', async (req, res, next) => { try { const found = await accessFor(req, res); if (!found) return; const { access, doc, signer } = found; access.lastAccessedAt = new Date(); signer.status = signer.status === 'pending' ? 'viewed' : signer.status; if (doc.status === 'Pending Signature') doc.status = 'Viewed'; doc.audits.push(audit(req, 'document_viewed', {}, signer._id)); await Promise.all([access.save(), doc.save()]); await trackSigner(req, doc, signer, 'document.viewed_by_signer', `${signer.name} opened "${doc.title}"`); res.json({ document: { id: doc._id, title: doc.title, pageCount: doc.pageCount, status: doc.status }, signer, fields: doc.fields.filter(f => String(f.signerId) === String(signer._id)).map(f => ({ ...f.toObject(), value: undefined })) }); } catch (e) { next(e); } });
router.get('/request/:token/pdf', async (req, res, next) => { try { const found = await accessFor(req, res); if (!found) return; res.type('pdf').send(await fs.readFile(found.doc.originalFile)); } catch (e) { next(e); } });
router.post('/request/:token/decline', async (req,res,next)=>{try{const found=await accessFor(req,res);if(!found)return;const reason=String(req.body.reason||'').trim().slice(0,1000);if(!reason)return res.status(400).json({error:'A decline reason is required'});found.signer.status='declined';found.doc.status='Declined';found.access.revokedAt=new Date();found.doc.audits.push(audit(req,'request_declined',{reason},found.signer._id));await Promise.all([found.access.save(),found.doc.save()]);await trackSigner(req,found.doc,found.signer,'document.declined',`${found.signer.name} declined "${found.doc.title}"`,{reason});res.json({ok:true})}catch(e){next(e)}});

router.post('/request/:token/complete', async (req, res, next) => {
  try {
    const found = await accessFor(req, res); if (!found) return; const { access, doc, signer } = found; if (!req.body.consent) return res.status(400).json({ error: 'Electronic signature consent is required' });
    const values = req.body.values || {}; const required = doc.fields.filter(f => String(f.signerId) === String(signer._id) && f.required); if (required.some(f => values[String(f._id)] === undefined || values[String(f._id)] === '')) return res.status(400).json({ error: 'Please complete all required fields before submitting' });
    doc.fields.forEach(f => { if (String(f.signerId) === String(signer._id) && values[String(f._id)] !== undefined) f.value = values[String(f._id)]; }); signer.status = 'completed'; signer.completedAt = new Date(); access.revokedAt = new Date(); doc.audits.push(audit(req, 'consent_accepted', {}, signer._id), audit(req, 'signer_completed', {}, signer._id));
    if (doc.signers.every(s => s.status === 'completed')) { const pdf = await PDFDocument.load(await fs.readFile(doc.originalFile)); const font = await pdf.embedFont(StandardFonts.Helvetica); for (const field of doc.fields) { const page = pdf.getPage(field.pageNumber - 1); const { width, height } = page.getSize(); const x = field.x * width, y = height - ((field.y + field.height) * height); const value = field.value; if (!value) continue; if ((field.type === 'signature' || field.type === 'initials' || field.type === 'stamp') && typeof value === 'string' && value.startsWith('data:image/')) { const bytes = Buffer.from(value.split(',')[1], 'base64'); const image = value.startsWith('data:image/png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); page.drawImage(image, { x, y, width: field.width * width, height: field.height * height }); } else page.drawText(String(value === true ? '✓' : value), { x, y: y + 3, size: Math.max(8, Math.min(14, field.height * height * .5)), font, color: rgb(.08, .1, .16), maxWidth: field.width * width }); }
      const bytes = await pdf.save(); doc.signedFile = await storage.save('signed', Buffer.from(bytes)); doc.signedHash = hash(bytes); doc.status = 'Signed'; doc.completedAt = new Date(); doc.audits.push(audit(req, 'signed_pdf_generated', { sha256: doc.signedHash }), audit(req, 'request_completed'));
      if (process.env.SIGN_CERTIFICATE_ENABLED !== 'false') { const certificate=await PDFDocument.create(); await appendCompletionCertificate(certificate,doc,doc.signedHash); const certificateBytes=await certificate.save(); doc.certificateFile=await storage.save('certificates',Buffer.from(certificateBytes)); doc.certificateHash=hash(certificateBytes); doc.audits.push(audit(req,'completion_certificate_generated',{sha256:doc.certificateHash})); }
      for (const [index, completedSigner] of doc.signers.entries()) { try { await mail.sendCompletion({ signer: completedSigner, document: doc, notifyHr: index === 0 }); doc.audits.push(audit(req,'completion_email_sent',{email:completedSigner.email},completedSigner._id)); } catch(err) { doc.audits.push(audit(req,'email_delivery_failed',{email:completedSigner.email,message:err.message},completedSigner._id)); } }
    } else doc.status = 'Partially Signed'; await Promise.all([access.save(), doc.save()]);
    await trackSigner(req, doc, signer, 'document.signed_by_signer', `${signer.name} signed "${doc.title}"`, { status: doc.status });
    if (doc.status === 'Signed') await trackSigner(req, doc, signer, 'document.completed', `"${doc.title}" was completed by all signers`, { reference: doc.referenceNumber });
    res.json({ ok: true, status: doc.status });
  } catch (e) { next(e); }
});

// ------------------------------------------------ document timeline

router.get('/:id/activity', authenticate, permit('documents.view'), guard(), async (req, res, next) => {
  try {
    const ActivityLog = require('../models/ActivityLog');
    const events = await ActivityLog.find({ documentId: req.document._id, companyId: req.user.companyId }).sort({ createdAt: 1 }).limit(500).lean();
    res.json({ documentId: req.document._id, title: req.document.title, events, audits: req.document.audits });
  } catch (e) { next(e); }
});

// ------------------------------------------------- internal sharing

router.get('/:id/members', authenticate, permit('documents.view'), guard(), async (req, res, next) => {
  try {
    const members = await DocumentMember.find({ documentId: req.document._id }).lean();
    const users = await User.find({ _id: { $in: members.map(member => member.userId) } }).select('firstName lastName email status').lean();
    const byId = new Map(users.map(user => [String(user._id), user]));
    res.json(members.map(member => {
      const user = byId.get(String(member.userId));
      return { id: member._id, userId: member.userId, permission: member.permission, fullName: user ? `${user.firstName} ${user.lastName}`.trim() : 'Removed user', email: user?.email };
    }));
  } catch (e) { next(e); }
});

router.post('/:id/members', authenticate, permit('documents.share'), guard('canShare'), async (req, res, next) => {
  try {
    const permission = req.body.permission === 'edit' ? 'edit' : 'view';
    const user = await User.findOne({ _id: req.body.userId, companyId: req.user.companyId, deletedAt: null });
    if (!user) return res.status(404).json({ error: 'That colleague is not in your organisation.' });
    if (String(user._id) === String(req.document.createdByUserId)) return res.status(400).json({ error: 'The owner already has full access.' });
    const member = await DocumentMember.findOneAndUpdate(
      { documentId: req.document._id, userId: user._id },
      { $set: { permission, companyId: req.user.companyId, createdBy: req.user._id } },
      { upsert: true, new: true },
    );
    await track(req, req.document, 'document.shared', `${req.user.fullName} shared "${req.document.title}" with ${user.email} (${permission})`, { metadata: { userId: String(user._id), permission } });
    res.status(201).json({ id: member._id, userId: user._id, permission, fullName: `${user.firstName} ${user.lastName}`.trim(), email: user.email });
  } catch (e) { next(e); }
});

router.delete('/:id/members/:userId', authenticate, permit('documents.share'), guard('canShare'), async (req, res, next) => {
  try {
    const member = await DocumentMember.findOneAndDelete({ documentId: req.document._id, userId: req.params.userId });
    if (!member) return res.status(404).json({ error: 'That colleague does not have access.' });
    const user = await User.findById(req.params.userId).select('email').lean();
    await track(req, req.document, 'document.unshared', `${req.user.fullName} removed ${user?.email || 'a colleague'} from "${req.document.title}"`, { metadata: { userId: String(req.params.userId) } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Colleagues who can be given access: everyone else active in the company.
router.get('/:id/shareable-users', authenticate, permit('documents.share'), guard('canShare'), async (req, res, next) => {
  try {
    const users = await User.find({ companyId: req.user.companyId, deletedAt: null, status: 'active', _id: { $ne: req.document.createdByUserId } }).select('firstName lastName email').sort({ firstName: 1 }).lean();
    res.json(users.map(user => ({ id: user._id, fullName: `${user.firstName} ${user.lastName}`.trim(), email: user.email })));
  } catch (e) { next(e); }
});

router.appendCompletionCertificate = appendCompletionCertificate;
module.exports = router;
