import type { Box, Point } from "./types";

/** An affine transform [a, b, c, d, e, f], applied as PDF applies it. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `a` composed with `b`: the result applies `b` first, then `a`. */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return IDENTITY;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

/**
 * Turn a display-space box a quarter turn clockwise with its page.
 *
 * Rotating a page has to carry whatever was placed on it, so a box at the top
 * left of a portrait page ends up at the top right once the page is turned.
 */
export function rotateBoxClockwise(box: Box, pageHeight: number): Box {
  return {
    x: pageHeight - (box.y + box.height),
    y: box.x,
    width: box.height,
    height: box.width,
  };
}

/** Turn unit-square stroke points a quarter turn clockwise inside their box. */
export function rotatePointsClockwise(points: Point[]): Point[] {
  return points.map((p) => ({ x: 1 - p.y, y: p.x }));
}

/**
 * Map the page's *current* display space back to the display space of the
 * source page, undoing the rotation the editor applied.
 *
 * Annotations are stored in the space the user is looking at. At export the
 * page carries its new /Rotate, so the annotations have to be drawn in the
 * source page's space and let that rotation move them into place.
 */
export function editorRotationMatrix(
  rotation: number,
  sourceWidth: number,
  sourceHeight: number
): Matrix {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [0, -1, 1, 0, 0, sourceHeight];
    case 180:
      return [-1, 0, 0, -1, sourceWidth, sourceHeight];
    case 270:
      return [0, 1, -1, 0, sourceWidth, 0];
    default:
      return IDENTITY;
  }
}

/**
 * The transform from an annotation's own space into PDF user space.
 *
 * The annotation space has its origin at the box's bottom-left *as displayed*,
 * with y pointing up — the convention pdf-lib draws in — so text and images
 * come out the right way up whatever the page's rotation is. `displayToUser`
 * carries the page rotation and the flip from screen coordinates.
 */
export function annotationMatrix(displayToUser: Matrix, box: Box): Matrix {
  const local: Matrix = [1, 0, 0, -1, box.x, box.y + box.height];
  return multiply(displayToUser, local);
}

export function clampBox(box: Box, pageWidth: number, pageHeight: number, minSize = 8): Box {
  const width = Math.max(minSize, Math.min(box.width, pageWidth));
  const height = Math.max(minSize, Math.min(box.height, pageHeight));
  return {
    width,
    height,
    x: Math.max(0, Math.min(box.x, pageWidth - width)),
    y: Math.max(0, Math.min(box.y, pageHeight - height)),
  };
}

export function boxOfPoints(points: Point[], padding = 0): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/** Map absolute points into 0–1 coordinates within a box. */
export function normalizeStroke(points: Point[], box: Box): Point[] {
  const w = box.width || 1;
  const h = box.height || 1;
  return points.map((p) => ({ x: (p.x - box.x) / w, y: (p.y - box.y) / h }));
}

export function denormalizeStroke(points: Point[], box: Box): Point[] {
  return points.map((p) => ({ x: box.x + p.x * box.width, y: box.y + p.y * box.height }));
}

/** #rrggbb → the 0–1 channel triple pdf-lib wants. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return { r: 0, g: 0, b: 0 };
  const value = parseInt(match[1], 16);
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}
