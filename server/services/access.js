const DocumentMember = require('../models/DocumentMember');
const { hasPermission, hasAnyPermission } = require('../config/permissions');
const { verticalFilter, normaliseVertical, normaliseVerticals } = require('../config/verticals');

const same = (a, b) => Boolean(a && b && String(a) === String(b));

/**
 * Whether a document sits in one of the verticals this user was assigned to.
 * Both sides are normalised so a record written before verticals existed counts
 * as unassigned rather than as nothing at all.
 */
const reachesVertical = (user, doc) => normaliseVerticals(user?.verticals).includes(normaliseVertical(doc?.vertical));

/** Someone who may see the whole organisation is above the vertical split. */
const seesEveryVertical = user => hasPermission(user, 'documents.view_all');

/**
 * Mongo filter for the documents a user may list. Always scoped to the
 * company on the authenticated session - never to anything the client sent.
 *
 * A vertical is both the grant and the boundary: inside the verticals they were
 * given a user sees every document, outside them none - not even one they own or
 * that a colleague shared with them. Only `documents.view_all` lifts it.
 */
async function documentListFilter(user) {
  const filter = { companyId: user.companyId };
  if (seesEveryVertical(user)) return filter;
  return { ...filter, ...verticalFilter(user.verticals) };
}

/**
 * What this user may do with this document. Company isolation is checked
 * first: a document from another tenant is invisible whatever the role says.
 * The vertical is checked immediately after, for the same reason.
 */
async function documentAccess(user, doc) {
  const denied = { canView: false, canEdit: false, canSend: false, canDelete: false, canDownload: false, canShare: false, canMoveVertical: false, isOwner: false, membership: null };
  if (!doc || !user) return denied;
  if (doc.companyId && !same(doc.companyId, user.companyId)) return denied;

  const isOrganisationWide = seesEveryVertical(user);
  if (!isOrganisationWide && !reachesVertical(user, doc)) return denied;

  const isOwner = same(doc.ownerId, user._id) || same(doc.createdByUserId, user._id);

  // Past the vertical boundary viewing is settled; a share only decides who may
  // change the document rather than merely read it. So the lookup is skipped
  // whenever it could not change the answer - for an owner and an administrator
  // it is already yes, and without a write permission to unlock it is moot.
  const couldShareMatter = !isOwner && !isOrganisationWide && hasAnyPermission(user, ['documents.edit', 'documents.send']);
  const membership = couldShareMatter ? await DocumentMember.findOne({ documentId: doc._id, userId: user._id }).lean() : null;

  const writable = isOwner || isOrganisationWide || membership?.permission === 'edit';
  return {
    canView: true,
    canEdit: writable && hasPermission(user, 'documents.edit'),
    canSend: writable && hasPermission(user, 'documents.send'),
    canDelete: (isOwner || isOrganisationWide) && hasPermission(user, 'documents.delete'),
    canDownload: hasPermission(user, 'documents.download'),
    canShare: (isOwner || isOrganisationWide) && hasPermission(user, 'documents.share'),
    // Moving a document between verticals changes who can see it at all, so it
    // stays with the administrators who can already see every vertical.
    canMoveVertical: isOrganisationWide && hasPermission(user, 'documents.edit'),
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

module.exports = { documentListFilter, documentAccess, requireDocument, reachesVertical, seesEveryVertical };
