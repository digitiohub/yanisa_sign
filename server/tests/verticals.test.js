const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';

const { VERTICAL_KEYS, DEFAULT_VERTICAL, normaliseVertical, normaliseVerticals, primaryVertical, verticalFilter, verticalLabel, verticalLabels } = require('../config/verticals');
const { documentListFilter, documentAccess, reachesVertical, seesEveryVertical } = require('../services/access');

const companyId = 'company-1';
const userIn = (verticals, permissions = ['documents.view']) => ({ _id: 'user-1', companyId, verticals: [].concat(verticals), permissions });
const docIn = (vertical, extra = {}) => ({ _id: 'doc-1', companyId, vertical, ownerId: 'someone-else', createdByUserId: 'someone-else', ...extra });

test('the catalogue holds exactly the agreed business lines', () => {
  assert.deepEqual(VERTICAL_KEYS, ['coworking', 'tech', 'gaas', 'media', 'studio', 'brand_collaboration', 'unassigned']);
  assert.equal(DEFAULT_VERTICAL, 'unassigned');
  assert.equal(verticalLabel('brand_collaboration'), 'Brand Collaboration');
});

test('an unknown or missing vertical falls back to unassigned', () => {
  assert.equal(normaliseVertical(undefined), 'unassigned');
  assert.equal(normaliseVertical('finance'), 'unassigned');
  assert.equal(normaliseVertical('tech'), 'tech');
});

test('the unassigned filter also matches records written before verticals existed', () => {
  assert.deepEqual(verticalFilter(['unassigned']), { vertical: { $in: ['unassigned', null] } });
  assert.deepEqual(verticalFilter(['tech']), { vertical: { $in: ['tech'] } });
  assert.deepEqual(verticalFilter(['tech', 'media']), { vertical: { $in: ['tech', 'media'] } });
  // Anything unrecognised is dropped, and an empty set falls back to the default
  // rather than matching nothing at all.
  assert.deepEqual(verticalFilter(['finance']), { vertical: { $in: ['unassigned', null] } });
  assert.deepEqual(verticalFilter([]), { vertical: { $in: ['unassigned', null] } });
});

test('a set of verticals is de-duplicated and never left empty', () => {
  assert.deepEqual(normaliseVerticals(['tech', 'tech', 'media']), ['tech', 'media']);
  assert.deepEqual(normaliseVerticals(['tech', 'finance']), ['tech']);
  assert.deepEqual(normaliseVerticals(undefined), ['unassigned']);
  assert.deepEqual(verticalLabels(['media', 'coworking']), ['Coworking', 'Media']);
});

test('a new document lands in the author’s first vertical', () => {
  assert.equal(primaryVertical(['media', 'tech']), 'media');
  assert.equal(primaryVertical([]), 'unassigned');
});

test('a user is pinned to their own verticals when listing documents', async () => {
  assert.deepEqual(await documentListFilter(userIn('tech')), { companyId, vertical: { $in: ['tech'] } });
  assert.deepEqual(await documentListFilter(userIn(['tech', 'media'])), { companyId, vertical: { $in: ['tech', 'media'] } });
});

test('documents.view_all lifts the vertical boundary', async () => {
  const filter = await documentListFilter(userIn('tech', ['documents.view', 'documents.view_all']));
  assert.deepEqual(filter, { companyId });
});

test('a document in another vertical is invisible, even to its owner', async () => {
  const owned = docIn('media', { ownerId: 'user-1', createdByUserId: 'user-1' });
  const access = await documentAccess(userIn('tech'), owned);
  assert.equal(access.canView, false);
  assert.equal(access.canEdit, false);
  assert.equal(access.canDownload, false);
});

test('a user reaches every vertical they were given', async () => {
  const user = userIn(['tech', 'media'], ['documents.view']);
  assert.equal((await documentAccess(user, docIn('tech'))).canView, true);
  assert.equal((await documentAccess(user, docIn('media'))).canView, true);
  assert.equal((await documentAccess(user, docIn('studio'))).canView, false);
});

test('inside their own vertical a user sees a colleague’s document', async () => {
  const access = await documentAccess(userIn('tech', ['documents.view', 'documents.download']), docIn('tech'));
  assert.equal(access.canView, true);
  assert.equal(access.canDownload, true);
  // Seeing it is not editing it: that still needs ownership or an edit share.
  assert.equal(access.canEdit, false);
});

test('a document from another tenant stays invisible whatever the vertical says', async () => {
  const access = await documentAccess(userIn('tech'), docIn('tech', { companyId: 'company-2' }));
  assert.equal(access.canView, false);
});

test('only an organisation-wide administrator may move a document between verticals', async () => {
  const admin = { _id: 'admin-1', companyId, verticals: ['tech'], permissions: ['documents.view_all', 'documents.edit'] };
  assert.equal((await documentAccess(admin, docIn('media'))).canMoveVertical, true);
  const owner = userIn('tech', ['documents.view', 'documents.edit']);
  assert.equal((await documentAccess(owner, docIn('tech', { ownerId: 'user-1', createdByUserId: 'user-1' }))).canMoveVertical, false);
});

test('records missing a vertical are compared as unassigned on both sides', () => {
  assert.equal(reachesVertical({ verticals: undefined }, { vertical: 'unassigned' }), true);
  assert.equal(reachesVertical({ verticals: ['unassigned'] }, {}), true);
  assert.equal(reachesVertical({ verticals: ['tech'] }, {}), false);
  assert.equal(reachesVertical({ verticals: ['tech', 'unassigned'] }, {}), true);
});

// The document list lets an administrator narrow to one vertical with
// ?vertical=. That override is gated on seesEveryVertical precisely because it
// would otherwise overwrite the vertical documentListFilter pinned.
test('only an organisation-wide administrator may pass a vertical query filter', () => {
  assert.equal(seesEveryVertical(userIn('tech')), false);
  assert.equal(seesEveryVertical(userIn('tech', ['documents.view', 'documents.view_all'])), true);
  assert.equal(seesEveryVertical({ permissions: ['*'] }), true);
});
