/**
 * Character-fit measurement.
 *
 * A PDF run is drawn at an exact width. Word re-sets the same characters with
 * its own metrics, so a run drifts a fraction of a point per glyph and a line
 * wraps a word early or a right-aligned block lands off the margin. Measuring
 * the run here with the same family and correcting it with `w:spacing` keeps
 * the run the width the PDF drew it — which is also what "preserve character
 * spacing" asks for.
 *
 * The correction only means anything when the browser actually has the family.
 * A substituted face measures a different typeface, so the run is left alone
 * rather than nudged towards the wrong answer.
 */

const FALLBACKS = ["monospace", "serif"] as const;
const PROBE = "mmmmmwwwwwiiiiill1234567890";

let ctx: CanvasRenderingContext2D | null | undefined;
const available = new Map<string, boolean>();

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    ctx = document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  return ctx;
}

function width(c: CanvasRenderingContext2D, font: string, text: string): number {
  c.font = font;
  return c.measureText(text).width;
}

/** True when this browser resolves `family` to the real face, not a fallback. */
export function hasFamily(family: string): boolean {
  const key = family.toLowerCase();
  const known = available.get(key);
  if (known !== undefined) return known;

  const c = context();
  if (!c || !family) {
    available.set(key, false);
    return false;
  }
  const quoted = JSON.stringify(family);
  const found = FALLBACKS.some((generic) => {
    const base = width(c, `72px ${generic}`, PROBE);
    const test = width(c, `72px ${quoted}, ${generic}`, PROBE);
    return Math.abs(base - test) > 0.5;
  });
  available.set(key, found);
  return found;
}

/**
 * Extra spacing, in points per character, that makes `text` occupy
 * `targetWidth` when Word sets it. Returns 0 when the measurement cannot be
 * trusted or the run already fits.
 */
export function fitLetterSpacing(
  text: string,
  family: string,
  bold: boolean,
  italic: boolean,
  fontSize: number,
  targetWidth: number
): number {
  if (text.length < 2 || fontSize <= 0 || !(targetWidth > 0)) return 0;
  const c = context();
  if (!c || !hasFamily(family)) return 0;

  const font = `${italic ? "italic " : ""}${bold ? "700 " : ""}${fontSize}px ${JSON.stringify(family)}`;
  const natural = width(c, font, text);
  if (!(natural > 0)) return 0;

  // Word adds the value after every character, the last one included.
  const perChar = (targetWidth - natural) / text.length;
  const limit = fontSize * 0.12;
  if (Math.abs(perChar) < 0.02) return 0;
  return Math.max(-limit, Math.min(limit, perChar));
}
