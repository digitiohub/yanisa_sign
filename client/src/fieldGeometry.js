// Field geometry for the designer. Sizes are authored in CSS pixels as they
// should look at 100% zoom, then converted into the page-relative fractions
// (0-1) the API stores, so a field keeps its PDF position across zoom levels,
// window sizes, reloads and screens.

export const FIELD_SIZES = {
  signature:{width:160,height:55}, initials:{width:80,height:40}, name:{width:130,height:36},
  email:{width:170,height:36}, phone:{width:130,height:36}, company:{width:150,height:36},
  text:{width:140,height:36}, multiline:{width:180,height:70}, checkbox:{width:28,height:28},
  radio:{width:28,height:28}, selection:{width:140,height:36}, date:{width:115,height:36},
  strikethrough:{width:140,height:24}, stamp:{width:100,height:70},
};
export const FIELD_MIN_SIZES = {
  signature:{width:100,height:40}, initials:{width:60,height:30}, multiline:{width:100,height:50},
  checkbox:{width:20,height:20}, radio:{width:20,height:20}, stamp:{width:60,height:40},
  strikethrough:{width:40,height:12},
};
// A4 rendered at the viewer's base scale, used only until a page has rendered.
export const FALLBACK_PAGE = { baseWidth:803, baseHeight:1136 };
const DEFAULT_SIZE = { width:140, height:36 };
const DEFAULT_MIN = { width:70, height:28 };
const AUTO_WIDTH_TYPES = new Set(['name','email','phone','company','text','date','selection']);
const MAX_AUTO_WIDTH = 320;
const DRAG_SNAP_PX = 2;   // gentle grid so a field can sit flush in a table cell
const RESIZE_SNAP_PX = 1; // whole pixels only, no sub-pixel jitter
// Hold Alt during either gesture to move/resize completely free of the grid.

export const getDefaultFieldSize = type => ({ ...(FIELD_SIZES[type] || DEFAULT_SIZE) });
export const getMinimumFieldSize = type => ({ ...(FIELD_MIN_SIZES[type] || DEFAULT_MIN) });

const LABEL_FONT = '12px Inter, system-ui, sans-serif';
const PADDING_X = 10, ICON_WIDTH = 13, GAP = 6, REQUIRED_WIDTH = 9;
let measureContext;
function textWidth(text) {
  if (measureContext === undefined) measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length * 6.4;
  measureContext.font = LABEL_FONT;
  return measureContext.measureText(text).width;
}

// Compact fields grow to fit "[icon] Label *" instead of clipping it.
export function getContentFieldSize(type, label = '', required = true) {
  const size = getDefaultFieldSize(type);
  if (!AUTO_WIDTH_TYPES.has(type)) return size;
  const content = PADDING_X * 2 + ICON_WIDTH + GAP + textWidth(label || type) + (required ? REQUIRED_WIDTH : 0);
  return { width: Math.round(Math.min(MAX_AUTO_WIDTH, Math.max(size.width, content))), height: size.height };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// page: { width, height } are the page's current on-screen size in CSS pixels
// (zoom included); { baseWidth, baseHeight } are the same page at 100% zoom.
export const pixelsToFraction = (px, base) => (base > 0 ? px / base : 0);
export const fractionToPixels = (fraction, base) => fraction * base;

export function screenToDocumentCoordinates(clientX, clientY, pageRect) {
  return { x: (clientX - pageRect.left) / pageRect.width, y: (clientY - pageRect.top) / pageRect.height };
}
export function documentToScreenCoordinates(field, pageRect) {
  return { left: field.x * pageRect.width, top: field.y * pageRect.height, width: field.width * pageRect.width, height: field.height * pageRect.height };
}
// Pixel size at 100% zoom -> stored fraction of the page.
export function sizeToFractions(size, page) {
  const base = { baseWidth: page?.baseWidth || FALLBACK_PAGE.baseWidth, baseHeight: page?.baseHeight || FALLBACK_PAGE.baseHeight };
  return { width: clamp(pixelsToFraction(size.width, base.baseWidth), 0.01, 1), height: clamp(pixelsToFraction(size.height, base.baseHeight), 0.01, 1) };
}

export function clampFieldToPage(field) {
  const width = clamp(field.width, 0.01, 1), height = clamp(field.height, 0.01, 1);
  return { ...field, width, height, x: clamp(field.x, 0, 1 - width), y: clamp(field.y, 0, 1 - height) };
}

const snapFraction = (fraction, base, grid) => (base > 0 ? (Math.round((fraction * base) / grid) * grid) / base : fraction);

// dx/dy are the TOTAL pointer displacement in screen pixels since pointerdown,
// measured against the geometry captured at pointerdown. Dividing by the page's
// current on-screen size keeps 1 pointer pixel = 1 visual pixel at every zoom
// level, because the page element is already scaled by the zoom.
export function calculateResize({ origin, dx, dy, page, type, snap = true }) {
  const min = sizeToFractions(getMinimumFieldSize(type), page);
  let width = origin.width + dx / page.width;
  let height = origin.height + dy / page.height;
  if (snap) { width = snapFraction(width, page.baseWidth, RESIZE_SNAP_PX); height = snapFraction(height, page.baseHeight, RESIZE_SNAP_PX); }
  return { width: clamp(width, min.width, 1 - origin.x), height: clamp(height, min.height, 1 - origin.y) };
}

export function calculateDrag({ origin, dx, dy, page, snap = true }) {
  let x = origin.x + dx / page.width;
  let y = origin.y + dy / page.height;
  if (snap) { x = snapFraction(x, page.baseWidth, DRAG_SNAP_PX); y = snapFraction(y, page.baseHeight, DRAG_SNAP_PX); }
  return { x: clamp(x, 0, 1 - origin.width), y: clamp(y, 0, 1 - origin.height) };
}
