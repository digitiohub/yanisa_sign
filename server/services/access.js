const DocumentMember = require('../models/DocumentMember');
const { hasPermission } = require('../config/permissions');

const same = (a, b) => Boolean(a && b && String(a) === String(b));

/**
 * Mongo filter for the documents a user may list. Always scoped to the
 * company on the authenticated session - never to anything the client sent.
 */
async function documentListFilter(user) {
  const filter = { companyId: user.companyId };
  if (hasPermission(user, 'documents.view_all')) return filter;

  const memberships = await DocumentMember.find({ userId: user._id, companyId: user.companyId }).select('documentId').lean();
  const sharedIds = memberships.map(member => member.documentId);
  const scopes = [{ ownerId: user._id }, { createdByUserId: user._id }];
  if (sharedIds.length) scopes.push({ _id: { $in: sharedIds } });
  if (hasPermission(user, 'documents.view_team') && user.workspaceId) scopes.push({ workspaceId: user.workspaceId });
  return { ...filter, $or: scopes };
}

/**
 * What this user may do with this document. Company isolation is checked
 * first: a document from another tenant is invisible whatever the role says.
 */
async function documentAccess(user, doc) {
  const denied = { canView: false, canEdit: false, canSend: false, canDelete: false, canDownload: false, canShare: false, isOwner: false, membership: null };
  if (!doc || !user) return denied;
  if (doc.companyId && !same(doc.companyId, user.companyId)) return denied;

  const isOwner = same(doc.ownerId, user._id) || same(doc.createdByUserId, user._id);
  const membership = isOwner ? null : await DocumentMember.findOne({ documentId: doc._id, userId: user._id }).lean();
  const isOrganisationWide = hasPermission(user, 'documents.view_all');
  const inTeam = hasPermission(user, 'documents.view_team') && same(doc.workspaceId, user.workspaceId);

  const canView = isOrganisationWide || isOwner || inTeam || Boolean(membership);
  if (!canView) return denied;

  const writable = isOwner || isOrganisationWide || membership?.permission === 'edit';
  return {
    canView,
    canEdit: writable && hasPermission(user, 'documents.edit'),
    canSend: writable && hasPermission(user, 'documents.send'),
    canDelete: (isOwner || isOrganisationWide) && hasPermission(user, 'documents.delete'),
    canDownload: hasPermission(user, 'documents.download'),
    canShare: (isOwner || isOrganisationWide) && hasPermission(user, 'documents.share'),
    isOwner,
    membership: membership || null,
  };
}

/**
 * Express helper: load the document, enforce one capability, attach both to
 * the request. Responds 404 when the document is outside the tenant so the
 * existence of other companies' records is never leaked.
 */
const requireDocument = (SignDocument, capability) => async (req, res, next) => {
  try {
    const doc = await SignDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const access = await documentAccess(req.user, doc);
    if (!access.canView) return res.status(404).json({ error: 'Document not found' });
    if (capability && !access[capability]) return res.status(403).json({ error: 'You do not have permission to perform this action on this document.' });
    req.document = doc;
    req.documentAccess = access;
    return next();
  } catch (err) { return next(err); }
};

module.exports = { documentListFilter, documentAccess, requireDocument };
