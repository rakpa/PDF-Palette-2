/**
 * Placing things where the reader sees them.
 *
 * A page carries a `/Rotate` that the viewer applies when it draws, so the
 * corner a reader calls "bottom right" is rarely the bottom right of the page's
 * own coordinate system. These helpers convert between the two, so a page
 * number or a crop box lands where it was asked for on a rotated page just as
 * it does on an upright one.
 */

export type Rotation = 0 | 90 | 180 | 270;

export function normalizeRotation(degrees: number): Rotation {
  const value = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  return value as Rotation;
}

/** The page's size as the reader sees it. */
export function visibleSize(
  width: number,
  height: number,
  rotation: Rotation
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
}

/**
 * Map a point from what the reader sees back into the page's own space.
 * Both are measured from their own bottom-left corner, y upwards.
 */
export function visibleToPage(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: Rotation
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: width - y, y: x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: y, y: height - x };
    default:
      return { x, y };
  }
}
