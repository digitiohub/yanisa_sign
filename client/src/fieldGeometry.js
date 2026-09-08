// Field geometry for the designer. Sizes are authored in CSS pixels as they
// should look at 100% zoom, then converted into the page-relative fractions
// (0-1) the API stores, so a field keeps its PDF position across zoom levels,
// window sizes, reloads and screens.

// Every single-line entry field is the same size so a column of them lines up
// inside a table instead of each one spilling out to fit its own caption.
export const FIELD_SIZES = {
  signature:{width:160,height:55}, initials:{width:80,height:40}, name:{width:150,height:30},
  email:{width:150,height:30}, phone:{width:150,height:30}, company:{width:150,height:30},
  text:{width:150,height:30}, multiline:{width:180,height:66}, checkbox:{width:26,height:26},
  radio:{width:26,height:26}, selection:{width:150,height:30}, date:{width:150,height:30},
  strikethrough:{width:150,height:24}, stamp:{width:100,height:70},
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
const DRAG_SNAP_PX = 2;   // gentle grid so a field can sit flush in a table cell
const RESIZE_SNAP_PX = 1; // whole pixels only, no sub-pixel jitter
// Hold Alt during either gesture to move/resize completely free of the grid.

export const getDefaultFieldSize = type => ({ ...(FIELD_SIZES[type] || DEFAULT_SIZE) });
export const getMinimumFieldSize = type => ({ ...(FIELD_MIN_SIZES[type] || DEFAULT_MIN) });

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

// Two fields sitting on the same pixels are impossible to tell apart or grab,
// and clicking the palette always aims at the same point on the page. Step a
// new box diagonally until it clears everything already on that page.
const CASCADE_STEP_PX = 14;
const boxesOverlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
export function findFreeSpot(box, placed, page) {
  const stepX = CASCADE_STEP_PX / (page?.baseWidth || FALLBACK_PAGE.baseWidth);
  const stepY = CASCADE_STEP_PX / (page?.baseHeight || FALLBACK_PAGE.baseHeight);
  let candidate = clampFieldToPage(box);
  for (let attempt = 0; attempt < 40 && placed.some(other => boxesOverlap(candidate, other)); attempt += 1) {
    const next = clampFieldToPage({ ...candidate, x: candidate.x + stepX, y: candidate.y + stepY });
    if (next.x === candidate.x && next.y === candidate.y) break; // wedged in the corner, leave it there
    candidate = next;
  }
  return candidate;
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
