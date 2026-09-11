// The business lines a user and a document can belong to. A closed list on
// purpose: verticals are the company's own structure, not something an
// administrator invents per tenant, so they live in code rather than in a
// collection and a document only ever carries the key.

const VERTICALS = [
  ['coworking', 'Coworking'],
  ['tech', 'Tech'],
  ['gaas', 'GaaS'],
  ['media', 'Media'],
  ['studio', 'Studio'],
  ['brand_collaboration', 'Brand Collaboration'],
  ['central', 'Central'],
  ['unassigned', 'Unassigned'],
];

// Where everything starts: users invited before a vertical was chosen and
// documents uploaded by them stay together in their own pool rather than
// leaking into a real business line.
const DEFAULT_VERTICAL = 'unassigned';

const VERTICAL_KEYS = VERTICALS.map(([key]) => key);
const LABELS = new Map(VERTICALS);
const verticalLabel = key => LABELS.get(key) || LABELS.get(DEFAULT_VERTICAL);
const isVertical = key => LABELS.has(key);
const normaliseVertical = key => (isVertical(key) ? key : DEFAULT_VERTICAL);

/**
 * A document belongs to exactly one vertical; a person can be given several.
 * Anything unrecognised is dropped, and an empty result falls back to the
 * default rather than to "no verticals at all", which would strand the account.
 */
const normaliseVerticals = (verticals) => {
  const keys = [...new Set([].concat(verticals || []).filter(isVertical))];
  return keys.length ? keys : [DEFAULT_VERTICAL];
};

/**
 * Mongo fragment matching the documents of the verticals a person can reach.
 * Records written before this release carry no `vertical` at all, so whenever
 * the default is among them a missing field has to match too.
 */
const verticalFilter = (verticals) => {
  const keys = normaliseVerticals(verticals);
  return { vertical: { $in: keys.includes(DEFAULT_VERTICAL) ? [...keys, null] : keys } };
};

/** The vertical a new document lands in when its author can reach several. */
const primaryVertical = (verticals) => normaliseVerticals(verticals)[0];

/** Reads a list of keys back as labels, in catalogue order. */
const verticalLabels = (verticals) => {
  const keys = new Set(normaliseVerticals(verticals));
  return VERTICALS.filter(([key]) => keys.has(key)).map(([, label]) => label);
};

const verticalOptions = () => VERTICALS.map(([key, label]) => ({ key, label }));

module.exports = { VERTICALS, VERTICAL_KEYS, DEFAULT_VERTICAL, verticalLabel, verticalLabels, isVertical, normaliseVertical, normaliseVerticals, primaryVertical, verticalFilter, verticalOptions };
